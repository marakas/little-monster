import assert from "node:assert";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import * as os from "node:os";

import {
  startScreencastCapture,
  getScreenshotDir,
} from "./visual_screencast.ts";
import chokidar from "chokidar";

import {
  initRealtime,
  isAgentSpeaking,
  onRealtimeAudio,
  sendRealtimeAudio,
  commitNow,
} from "./realtimeClient.ts";

import { audioCapture } from "./audioCapture.ts";

import { writeWavFile } from "./upsample.ts";

import {
  registerVisionProvider,
  startPhasedInterview,
  registerAssessmentProvider,
  onRealtimeEvent,
} from "./realtimeClient.ts";

import {
  analyzeScreenshot,
  analyzeSnapshot,
  type VisionResult,
} from "./pythonBridge.ts";

import ffmpeg from "fluent-ffmpeg";
// import puppeteer from 'puppeteer-extra'
// import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { getStream, launch } from "puppeteer-stream";

import {
  MEET_BOT_MAX_DURATION,
  ENABLE_FULL_AUDIO_ACCUMULATION,
} from "./constants.ts";
import { env } from "./env.ts";
import state, { type Page } from "./state.ts";
import { stopAudioProcessing, stopMeetBot } from "./stop_meet_bot.ts";
import {
  delay,
  monitorKickout,
  monitorSpeakers,
  openChatWindow,
  sendChatMessage,
  detectMeetingPlatform,
  transformZoomUrl,
  type MeetingPlatform,
} from "./utils.ts";

import audioProcessor from "./audio-processor.ts";
import { joinGoogleMeet } from "./platforms/joinGoogleMeet.ts";
import { enableStreamingMic } from "./micStreaming.ts";

let wasSpeaking = false;
let lastSpeechAt = Date.now();
let rollingTranscript = "";

const recordingsDir = "./recordings";
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

let lastAssessAt = 0;
const ASSESS_COOLDOWN_MS = 55_000;

// Instagram rubric (what “good” looks like) — keep short & concrete
const INSTAGRAM_REQUIREMENTS = `
# Scenario: Design Instagram
Functional:
- Users post photos/videos with captions, follow, like, comment, notifications
- Home feed: personalized, ranked, infinite scroll
- Search/explore; user profiles; basic moderation

Non-functional:
- Tens of millions DAU, global; low latency home feed (<200ms P50 at edge)
- High availability; eventual consistency OK for counts/timelines
- Media heavy: upload, transcode, CDN

Key areas expected:
- Data model (users, posts, follows, likes, comments), indexes & hot keys
- Media pipeline (upload, virus scan, transcode variants, metadata store, CDN)
- Feed generation (push/pull, fanout/fanin, ranking features, pagination)
- Caching (CDN, Redis timelines), invalidation strategy
- Sharding/partitioning; backpressure; queues; idempotency; retries
- Observability (metrics/traces/alerts) and degradation levers
- AuthN/Z, privacy, abuse mitigation basics
`.trim();

function appendTranscript(line: string) {
  if (!line) return;
  rollingTranscript += (rollingTranscript ? "\n" : "") + line.trim();
}

function chunkHasVoice16k(ab: ArrayBuffer): boolean {
  // chunks are s16le mono @16k (from ffmpeg)
  const v = new Int16Array(ab);
  if (v.length === 0) return false;
  let sum = 0,
    n = 0;
  // subsample to keep it cheap
  for (let i = 0; i < v.length; i += 16) {
    sum += v[i] * v[i];
    n++;
  }
  const rms = Math.sqrt(sum / Math.max(1, n)); // 0..32767
  return rms > 200; // tweak 120–300 if needed
}

// ✅ **Enhanced Audio Processing with Real-time Speech Detection**
function startAudioProcessing() {
  if (state.audioProcessingInterval) {
    console.log("⚠️ Audio processing is already running.");
    return;
  }

  console.log("🎤 Starting enhanced audio processing...");

  // Reset audio processor for new session
  audioProcessor.reset();

  // Balanced monitoring with buffer management
  state.audioProcessingInterval = setInterval(() => {
    if (!state.isBotRunning) {
      console.log(
        "🛑 Bot stopped but interval still running. Clearing it now."
      );
      stopAudioProcessing();
      return;
    }

    const silentForMs = Date.now() - lastSpeechAt;
    if (wasSpeaking && silentForMs > 700) {
      wasSpeaking = false;
      commitNow(); // force a turn boundary if server VAD missed it
    }
  }, 200);

  console.log("✅ Enhanced audio processing started with buffer management");
}

// ✅ **Start Meet Bot**
export async function startMeetBot(
  meetUrl: string,
  meetingId: string,
  platform?: MeetingPlatform
) {
  if (state.isBotRunning || state.meetingId === meetingId) {
    console.log("🚨 A bot is already running! Ignoring new request.");
    return { status: "error", message: "Bot already running" };
  }
  if (state.stopTimeout) {
    clearTimeout(state.stopTimeout);
    console.log("🧹 Cleared previous timeout.");
    state.stopTimeout = null;
  }
  try {
    if (!meetingId) {
      console.error("❌ Missing meeting_id! Cannot proceed.");
      return { status: "error", message: "Meeting ID is required" };
    }

    // ✅ Validate meetUrl parameter
    if (!meetUrl || typeof meetUrl !== "string" || meetUrl.trim() === "") {
      console.error("❌ Missing or invalid meetUrl! Cannot proceed.");
      return { status: "error", message: "Valid meeting URL is required" };
    }

    // ✅ Transform Zoom URLs to standard format if needed
    const transformedMeetUrl = transformZoomUrl(meetUrl);

    // ✅ Detect platform if not provided
    const meetingPlatform =
      platform || detectMeetingPlatform(transformedMeetUrl);

    if (meetingPlatform === "unknown") {
      console.error("❌ Unsupported meeting platform! Cannot proceed.");
      return { status: "error", message: "Unsupported meeting platform" };
    }

    let latestScreenshotPath: string | null = null;
    registerVisionProvider(async () => {
      if (!latestScreenshotPath) {
        console.log("[vision] provider: no screenshot yet");
        return { state: "unknown", summary: "No screenshot yet." };
      }

      const res = await analyzeScreenshot(latestScreenshotPath);
      const state =
        res.whiteboard?.state ??
        (/blank whiteboard|whiteboard.*blank/i.test(res.summary)
          ? "blank"
          : /whiteboard|miro|excalidraw|jamboard|figma|canvas/i.test(
              res.summary
            )
          ? "has_content"
          : /does not show a whiteboard|no whiteboard/i.test(res.summary)
          ? "none"
          : "unknown");

      const reply = { state, summary: res.summary, app: res.whiteboard?.app };
      console.log(`[vision] provider → ${JSON.stringify(reply)}`); // ← you should SEE this
      return reply;
    });

    registerAssessmentProvider(async () => {
      const now = Date.now();
      if (now - lastAssessAt < ASSESS_COOLDOWN_MS) {
        return { ok: true, live: null }; // quiet success to avoid spamming the model
      }
      lastAssessAt = now;

      const imagePath = latestScreenshotPath;
      if (!imagePath) {
        return {
          ok: true,
          live: null,
          diagram_state: "unknown",
          diagram_components_count: 0,
        };
      }

      try {
        const out = await analyzeSnapshot({
          imagePath,
          transcriptText: rollingTranscript || "",
          requirementsText: INSTAGRAM_REQUIREMENTS,
        });

        const diagramState = out.whiteboard?.state ?? "unknown";
        const compCount = Array.isArray(out.diagram?.components)
          ? out.diagram.components.length
          : 0;

        return {
          ok: true,
          live: out.live || null,
          diagram_state: diagramState,
          diagram_components_count: compCount,
        };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    });

    // ✅ Store platform in state for use across modules
    state.meetingPlatform = meetingPlatform;

    console.log(`🚀 Starting bot for ${meetingPlatform} meeting: ${meetUrl}`);

    // 🧪 Initialize experimental audio accumulation mode
    if (ENABLE_FULL_AUDIO_ACCUMULATION) {
      console.log("Full audio accumulation mode enabled");
      state.isFullAccumulationMode = true;
      state.fullAudioAccumulator = Buffer.alloc(0);
      state.meetingSpeakers.clear(); // Reset speakers for new meeting
      state.speakerHistory = []; // Reset speaker history for new meeting
      state.currentAudioOffsetMs = 0; // Reset audio offset
      state.lastSpeakerUpdate = Date.now(); // Initialize last update time

      // 🤖 Initialize AI merging arrays
      state.chunkedTranscriptions = [];
      state.fullAudioTranscriptions = [];
    } else {
      state.isFullAccumulationMode = false;
    }

    await initRealtime(process.env.OPENAI_API_KEY!);

    // Subscribe to Realtime events (transcripts, etc.)
    onRealtimeEvent((ev: any) => {
      // Depending on SDK version this name can differ.
      if (
        ev?.type === "input_audio_transcription.completed" &&
        ev?.transcript
      ) {
        appendTranscript(ev.transcript);

        // (optional) also persist to your final transcription log
        try {
          if (state.transcriptionLogPath) {
            fs.appendFileSync(state.transcriptionLogPath, ev.transcript + "\n");
          }
        } catch {}
      }

      // Debug unknown events once:
      // if (!ev || !ev.type) console.log("RT event:", ev);
    });

    // Start enhanced audio processing
    startAudioProcessing();
    state.isClosing = false; // reset to false if previous session was running

    // ✅ Create session directory based on meeting_id
    state.sessionDir = path.join(recordingsDir, meetingId);
    await mkdir(state.sessionDir, { recursive: true });

    const jobId = `meetbot_${Date.now()}`;
    state.currentRecordingPath = path.join(state.sessionDir, `${jobId}.webm`);

    // Create separate transcription log file paths
    state.transcriptionLogPath = path.join(
      state.sessionDir,
      `${jobId}_transcriptions.log` // AI-enhanced final transcription
    );
    state.chunkedTranscriptionLogPath = path.join(
      state.sessionDir,
      `${jobId}_transcriptions-chunked.log` // Real-time chunked transcription
    );
    state.fullTranscriptionLogPath = path.join(
      state.sessionDir,
      `${jobId}_transcriptions-full-transcript.log` // Full audio transcription
    );

    state.transcriptionLog = []; // Reset for new session

    console.log(`📂 Created session directory: ${state.sessionDir}`);
    console.log(
      `${env.RECORD_VIDEO ? "🎥 Video" : "🎙️ Audio"} will be saved at: ${
        state.currentRecordingPath
      }`
    );
    console.log(
      `📝 AI-Enhanced Final Transcription: ${state.transcriptionLogPath}`
    );
    console.log(
      `📝 Real-time Chunked Transcription: ${state.chunkedTranscriptionLogPath}`
    );
    console.log(
      `📝 Full Audio Transcription: ${state.fullTranscriptionLogPath}`
    );

    // Store session info globally
    state.meetingId = meetingId;

    console.log(
      `🚀 Launching browser for ${meetingPlatform} meeting: ${meetUrl}...`
    );
    state.isBotRunning = true;
    state.isBotPaused = false;

    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
      "--remote-debugging-port=9222",
      "--disable-accelerated-video-decode",

      // Enhanced stealth measures (from your working code)
      "--disable-blink-features=AutomationControlled",
      "--exclude-switches=enable-automation",
      "--disable-extensions-except",
      "--disable-plugins-discovery",
      "--no-first-run",
      "--disable-default-apps",
      "--disable-component-extensions-with-background-pages",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",

      "--allow-running-insecure-content",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
    ];

    // ✅ **PLATFORM-SPECIFIC APPROACH**: Fake flags only for Zoom, real media access for Google Meet
    if (meetingPlatform === "zoom") {
      browserArgs.push(
        "--use-fake-device-for-media-stream", // Zoom uses browser-side capture
        "--use-fake-ui-for-media-stream" // Zoom uses browser-side capture
      );
      console.log("🔧 Using fake media flags for Zoom (browser-side capture)");
    } else {
      browserArgs.push(
        "--use-fake-device-for-media-stream",
        "--use-file-for-fake-audio-capture=/dev/null", // avoid errors
        "--use-fake-ui-for-media-stream",
        "--enable-logging",
        "--enable-audio-output",
        "--allow-file-access-from-files"
      );
      // For Google Meet: Allow real media access so puppeteer-stream can work
      console.log(
        "🔧 Using real media access for Google Meet (puppeteer-stream capture)"
      );
    }

    // Construct default PulseAudio socket path
    const pulseSocket =
      process.env.PULSE_SERVER ||
      `unix:${path.join(os.homedir(), ".config/pulse/native")}`;

    state.activeBrowser = await launch({
      headless: false,
      args: browserArgs,
      defaultViewport: {
        height: 1080,
        width: 1920,
      },
      executablePath: env.PUPPETEER_EXECUTABLE_PATH,
      env: {
        ...process.env,
        PULSE_SERVER: pulseSocket,
      },
    });

    assert(state.activeBrowser);
    const page = await state.activeBrowser.newPage();
    await enableStreamingMic(page);
    let debugCounter = 0;

    // --- just above onRealtimeAudio(...) in startMeetBot:
    let outPrimed = false;
    let outWarmup: number[] = [];
    const MODEL_OUT_RATE = 24000; // server sends 24 kHz PCM16
    const PREROLL_MS = 220; // 200–250ms works well
    const PREROLL_SAMPLES = Math.floor((MODEL_OUT_RATE * PREROLL_MS) / 1000);

    onRealtimeAudio((ab: ArrayBuffer) => {
      const int16 = new Int16Array(ab);

      // OPTIONAL: debug only; guard the disk write behind an env flag
      if (process.env.RT_DEBUG_WAV === "1") {
        try {
          writeWavFile(
            Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength),
            MODEL_OUT_RATE,
            path.join(
              "recordings",
              `rt_reply_${Date.now()}_${MODEL_OUT_RATE / 1000}k.wav`
            )
          );
        } catch {}
      }

      if (!outPrimed) {
        // accumulate until we have enough to cover the initial WebRTC pull
        for (let i = 0; i < int16.length; i++) outWarmup.push(int16[i]);
        if (outWarmup.length >= PREROLL_SAMPLES) {
          const firstBurst = outWarmup.splice(0, outWarmup.length); // flush all we have
          // fire-and-forget to avoid serializing on small chunks
          // (enqueuePcmAt(rate, Int16[]))
          void state.page!.evaluate(
            ({ rate, samples }) => (window as any).enqueuePcmAt(rate, samples),
            { rate: MODEL_OUT_RATE, samples: firstBurst }
          );
          outPrimed = true;
        }
        return;
      }

      // after priming, stream normally; avoid await to keep up under burst
      void state.page!.evaluate(
        ({ rate, samples }) => (window as any).enqueuePcmAt(rate, samples),
        { rate: MODEL_OUT_RATE, samples: Array.from(int16) }
      );
    });
    state.page = page;

    // ✅ Wait for browser to be fully ready
    console.log("⏳ Waiting for browser to be fully initialized...");
    await delay(2000);

    console.log("🎥 Starting recording...");

    const file = fs.createWriteStream(state.currentRecordingPath);

    const audioStream = new PassThrough();

    const audioSampleRate = 16000;
    console.log(
      `🎵 Using ${audioSampleRate} Hz sample rate for ${meetingPlatform} platform`
    );

    state.activeProcess = ffmpeg()
      .input(audioStream)
      .inputFormat("webm")
      .audioCodec("pcm_s16le")
      .audioFrequency(16000) // Realtime API expects 16k in
      .audioChannels(1)
      .format("s16le") // <-- RAW PCM, not WAV
      .on("error", (err) => console.error("FFmpeg Error:", err));

    const toRealtime = new PassThrough();
    state.activeProcess.pipe(toRealtime).on("data", (chunk: Buffer) => {
      const ab = new Uint8Array(chunk).buffer;
      const humanVoiced = chunkHasVoice16k(ab);
      if (humanVoiced && !isAgentSpeaking()) {
        sendRealtimeAudio(ab, 16000);
        wasSpeaking = true;
        lastSpeechAt = Date.now();
      }
    });

    state.activeStream = new PassThrough();
    state.activeStream.pipe(file);
    state.activeStream.pipe(audioStream);

    await delay();

    const context = state.activeBrowser.defaultBrowserContext();

    // ✅ **Grant Permissions for WebRTC & Media** (enhanced from your working code)
    await context.overridePermissions(transformedMeetUrl, [
      "camera",
      "microphone",
      "notifications",
    ]);

    page.setDefaultNavigationTimeout(120000);

    await page.goto(transformedMeetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    // optional: give SPA a moment, then proceed
    await page.waitForSelector("body", { timeout: 60_000 });
    await joinGoogleMeet(page, transformedMeetUrl);

    await audioCapture(page, meetingPlatform);
    monitorKickout(page);

    console.log("📡 Bot is now listening to the meeting...");

    // Start super-simple screenshots (1 fps is fine for diagram detection)
    await startScreencastCapture(state.page!, state.sessionDir!, {
      fps: 0.33, // 1 every ~3s (tune this)
      quality: 60, // tune 40–70 if you want lighter writes
      maxWidth: 1280,
      maxHeight: 720,
    });
    const dir = getScreenshotDir();

    if (dir) {
      const absDir = path.resolve(dir);
      const MIN_ANALYSIS_INTERVAL_MS = Number(
        process.env.VISION_MIN_INTERVAL_MS || 5000
      );
      let lastRun = 0;

      console.log(`👀 Watching for new screenshots in ${absDir}`);

      const watcher = chokidar.watch(absDir, {
        persistent: true,
        ignoreInitial: true,
        depth: 0,
        usePolling: true, // important for Docker/overlayfs
        interval: 500,
        binaryInterval: 500,
        awaitWriteFinish: {
          stabilityThreshold: 700,
          pollInterval: 200,
        },
      });

      const maybeAnalyze = async (filePath: string) => {
        if (!filePath.toLowerCase().endsWith(".jpg")) return;
        latestScreenshotPath = filePath;

        console.log(`👀 [vision] file event: ${filePath}`);
        const now = Date.now();
        if (now - lastRun < MIN_ANALYSIS_INTERVAL_MS) {
          if (process.env.VISION_DEBUG === "1") {
            console.log("[vision] throttled – skipping analysis");
          }
          return;
        }
        lastRun = now;

        try {
          const res = await analyzeScreenshot(filePath);
          console.log(
            `[vision] summary: ${res?.summary?.slice(0, 200) || "<empty>"}`
          );
          //await sendUserText(`[Vision] ${res.summary}`);
        } catch (e: any) {
          console.error("[vision] analysis failed:", e?.message || e);
        }
      };

      watcher
        .on("add", (p) => maybeAnalyze(p))
        .on("change", (p) => maybeAnalyze(p))
        .on("error", (err) => console.error("[vision] watcher error:", err));

      // Fallback scanner (in case fs events are missed)
      const FALLBACK_SCAN_SEC = Number(process.env.VISION_SCAN_SEC || 10);
      const scanTimer = setInterval(async () => {
        try {
          const entries = await fsp.readdir(absDir, { withFileTypes: true });
          const jpgPaths = entries
            .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".jpg"))
            .map((d) => path.join(absDir, d.name));

          if (!jpgPaths.length) return;

          const stats = await Promise.all(
            jpgPaths.map(async (p) => {
              const st = await fsp.stat(p);
              return { p, mtimeMs: st.mtimeMs };
            })
          );

          stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
          await maybeAnalyze(stats[0].p);
        } catch {
          /* silent */
        }
      }, FALLBACK_SCAN_SEC * 1000);
    }

    await startPhasedInterview();

    // ✅ **Auto-stop the bot after the maximum duration**
    state.stopTimeout = setTimeout(() => {
      console.log(
        `⏰ Maximum duration of ${env.MEET_BOT_MAX_DURATION_MINUTES} minutes reached. Stopping bot.`
      );
      stopMeetBot();
    }, MEET_BOT_MAX_DURATION);

    return { status: "success", message: "Bot started successfully" };
  } catch (error) {
    console.error("❌ Error starting meet bot:", error);
    await stopMeetBot();
    return { status: "error", message: "Failed to start bot" };
  }
}
