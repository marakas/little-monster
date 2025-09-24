//meetbot.ts
import assert from "node:assert";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fetchLessonOrThrow } from "./lessons/api.ts";
import {
  runLessonOrchestrated,
  bindLessonForPick,
} from "./engine/lessonOrchestrator.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "./sessions/realtimeSession.ts";
import {
  startScreencastCapture,
  getScreenshotDir,
} from "./visual_screencast.ts";
import {
  speakOnce,
  onRealtimeAudio,
  setRealtimeArmed,
  clearInputBuffer,
} from "./realtimeClient.ts";

import { audioCapture } from "./audioCapture.ts";
import { writeWavFile } from "./upsample.ts";
import { onRealtimeEvent } from "./realtimeClient.ts";
import { launch } from "puppeteer-stream";
import { MEET_BOT_MAX_DURATION } from "./constants.ts";
import { env } from "./env.ts";
import state, { waitUntilJoined, resetAudioMux } from "./state.ts";
import { stopMeetBot } from "./stop_meet_bot.ts";
import {
  delay,
  monitorKickout,
  detectMeetingPlatform,
  transformZoomUrl,
  type MeetingPlatform,
} from "./utils.ts";
import {
  joinGoogleMeet,
  clickMeetGotIt,
  presentChromeTabInMeet,
} from "./platforms/joinGoogleMeet.ts";
import { enableStreamingMic } from "./micStreaming.ts";

const VISION_ENABLED = process.env.VISION_ENABLED === "1";
let rollingTranscript = "";
let latestScreenshotPath: string | null = null;

const recordingsDir = "./recordings";
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

let outboundPrimed = false;

async function warmOutboundOnce() {
  if (outboundPrimed) return;
  const MODEL_OUT_RATE = 24000; // matches your onRealtimeAudio rate
  const PAD_MS = 1000; // 1s of silence to wake WebRTC path
  const padSamples = Math.floor((MODEL_OUT_RATE * PAD_MS) / 1000);
  const zeroPad = new Array(padSamples).fill(0);

  // queue on the page's audio graph
  await state.page!.evaluate(
    ({ rate, pad }) => (window as any).enqueuePcmAt(rate, pad),
    { rate: MODEL_OUT_RATE, pad: zeroPad }
  );
  outboundPrimed = true;
}

async function waitForOutboundReady() {
  // We are past "Ask to join" and have a Leave button, but give WebRTC a beat.
  await delay(2000); // settle time for Meet to attach outbound track
  await warmOutboundOnce(); // ensure sender path is hot before first TTS
}

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

// ✅ **Start Meet Bot**
export async function startMeetBot(
  meetUrl: string,
  meetingId: string,
  lessonId: string,
  userId: string,
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

    if (!lessonId || !lessonId.trim()) {
      return { status: "error", message: "lessonId is required" };
    }

    if (!userId || !userId.trim()) {
      return { status: "error", message: "userId is required" };
    }

    // ✅ Validate meetUrl parameter
    if (!meetUrl || typeof meetUrl !== "string" || meetUrl.trim() === "") {
      console.error("❌ Missing or invalid meetUrl! Cannot proceed.");
      return { status: "error", message: "Valid meeting URL is required" };
    }

    // ✅ Fetch lesson up front (fail fast)
    const lesson = await fetchLessonOrThrow(lessonId, { userId });
    bindLessonForPick(lesson);

    // ✅ Transform Zoom URLs to standard format if needed
    const transformedMeetUrl = transformZoomUrl(meetUrl);

    // ✅ Detect platform if not provided
    const meetingPlatform =
      platform || detectMeetingPlatform(transformedMeetUrl);

    if (meetingPlatform === "unknown") {
      console.error("❌ Unsupported meeting platform! Cannot proceed.");
      return { status: "error", message: "Unsupported meeting platform" };
    }

    // ✅ Store platform in state for use across modules
    state.meetingPlatform = meetingPlatform;

    console.log(`🚀 Starting bot for ${meetingPlatform} meeting: ${meetUrl}`);
    resetAudioMux();
    if (state.muxWatchdog) {
      clearInterval(state.muxWatchdog);
      state.muxWatchdog = null;
    }


    let lastTtsAt = 0;
    // Subscribe to Realtime events (transcripts, etc.)
    onRealtimeEvent((ev: any) => {
      if (
        ev?.type === "input_audio_transcription.completed" &&
        ev?.transcript
      ) {
        appendTranscript(ev.transcript);

        try {
          if (state.transcriptionLogPath) {
            fs.appendFileSync(state.transcriptionLogPath, ev.transcript + "\n");
          }
        } catch {}
      }

      if (ev?.type === "response.created") {
        // new utterance -> re-prime
        outPrimed = false;
        outWarmup.length = 0;
      }

      // Debug unknown events once:
      // if (!ev || !ev.type) console.log("RT event:", ev);
    });

    // Start enhanced audio processing
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
        //"--use-fake-ui-for-media-stream",
        "--enable-logging",
        "--enable-audio-output",
        "--allow-file-access-from-files"
      );
      // For Google Meet: Allow real media access so puppeteer-stream can work
      console.log(
        "🔧 Using real media access for Google Meet (puppeteer-stream capture)"
      );
    }

    //browserArgs.push(`--auto-select-desktop-capture-source=${SHARE_TAB_TITLE}`);
    browserArgs.push("--auto-select-desktop-capture-source=Google");

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
    await page.bringToFront();
    await enableStreamingMic(page);

    let outPrimed = false;
    let outWarmup: number[] = [];
    const MODEL_OUT_RATE = 24000; // server sends 24 kHz PCM16
    const PREROLL_MS = 160;
    const PREROLL_SAMPLES = Math.floor((MODEL_OUT_RATE * PREROLL_MS) / 1000);

    onRealtimeAudio((ab: ArrayBuffer) => {
      const now = Date.now();
      if (now - lastTtsAt > 250) {
        // gap detector between chunks/utterances
        outPrimed = false;
        outWarmup.length = 0;
      }
      lastTtsAt = now;

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
          const zeroPad = new Array(PREROLL_SAMPLES).fill(0); // push a brief silence frame first to wake up the ScriptProcessor pull

          void state.page!.evaluate(
            ({ rate, pad, samples }) => {
              (window as any).enqueuePcmAt(rate, pad);
              (window as any).enqueuePcmAt(rate, samples);
            },
            { rate: MODEL_OUT_RATE, pad: zeroPad, samples: firstBurst }
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

    const context = state.activeBrowser.defaultBrowserContext();
    const meetOrigin = new URL(transformedMeetUrl).origin;
    // ✅ **Grant Permissions for WebRTC & Media** (enhanced from your working code)
    await context.overridePermissions(meetOrigin, [
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
    page.on("console", (m) => console.log("[meet]", m.text()));
    page.on("pageerror", (e) => console.log("[meet][pageerror]", e));
    page.on("requestfailed", (r) =>
      console.log("[meet][reqfail]", r.url(), r.failure()?.errorText)
    );

    await joinGoogleMeet(page, transformedMeetUrl);
    await audioCapture(page, meetingPlatform);
    monitorKickout(page);

    console.log("📡 Bot is now listening to the meeting...");

    if (VISION_ENABLED) {
      // dynamic import so we avoid pulling chokidar when off
      const { default: chokidar } = await import("chokidar");

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

        // Chockidar watches the filesystem for new screenshot images
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
          clickMeetGotIt(state.page);
          console.log("state dismissed: ", state.dismissed);
          console.log(`👀 [vision] file event: ${filePath}`);
          const now = Date.now();
          if (now - lastRun < MIN_ANALYSIS_INTERVAL_MS) {
            if (process.env.VISION_DEBUG === "1") {
              console.log("[vision] throttled – skipping analysis");
            }
            return;
          }
          lastRun = now;
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
              .filter(
                (d) => d.isFile() && d.name.toLowerCase().endsWith(".jpg")
              )
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
    } else {
      console.log(
        "🧯 Vision pipeline disabled (set VISION_ENABLED=1 to re-enable)."
      );
    }

    // Make sure we’re already in the call and outbound is primed…
    await waitUntilJoined(120_000);
    await waitForOutboundReady();

    // Open the presenter tab -> Google
    const SHARE_TAB_TITLE = process.env.PRESENTER_TITLE ?? "Google";
    const PRESENTER_URL =
      process.env.PRESENTER_URL ?? "https://www.google.com/ncr";

    const presenterPage = await state.activeBrowser!.newPage();
    await presenterPage.goto(PRESENTER_URL, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });

    // Verify Chrome sees the expected title for auto-select
    const actualTitle = await presenterPage.title();
    console.log("[presenter] title ->", actualTitle);

    // Be lenient: some locales still return "Google"
    if (!actualTitle.includes(SHARE_TAB_TITLE)) {
      console.warn(
        `[presenter] Title mismatch. Expected to include "${SHARE_TAB_TITLE}".`
      );
    }

    await delay(800); // give Chrome time to register the tab
    await state.page!.bringToFront(); // focus Meet for UI clicks

    // Kick off share
    await presentChromeTabInMeet(state.page!);

    // Best-effort confirmation (you already have this check later; it’s fine to keep one)
    const presenting = await state.page!.evaluate(() => {
      const t = document.body.innerText || "";
      return (
        t.includes("You’re presenting") ||
        t.includes("You are presenting") ||
        t.includes("共有しています") ||
        t.includes("提示しています")
      );
    });
    console.log(
      presenting ? "✅ Presenting detected" : "⚠️ Presenting not detected"
    );

    setRealtimeArmed(true); // now safe to allow auto turns
    clearInputBuffer(); // first clear (pre-greeting)
    let greetingPending = true;

    // Hook into the existing session event stream you already subscribed to
    onRealtimeEvent((ev: any) => {
      // when the manual greeting finishes, arm auto-turns
      if (
        greetingPending &&
        (ev.type === "response.completed" ||
          ev.type === "response.failed" ||
          ev.type === "response.canceled")
      ) {
        greetingPending = false;
        clearInputBuffer();
        // NOW let the SDK manage turns and barge-in
        setRealtimeArmed(true);
      }
    });

    await openRealtimeSession("You are a concise, polite instructor.");
    speakOnce("Audio path check. One, two, three.");
    await new Promise((r) => setTimeout(r, 3000));
    await closeRealtimeSession();

    await runLessonOrchestrated(state.page!, lesson, {
      meetingId,
      introMs: 60_000,
      vocabMs: 5 * 60_000,
      speakingMs: 5 * 60_000,
      conversationMs: 5 * 60_000,
      wrapMs: 30_000,
    });

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
