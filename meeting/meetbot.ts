import assert from "node:assert";
import * as fs from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import * as os from "node:os";
import { writeFileSync } from "fs";

import {
  initRealtime,
  isAgentSpeaking,
  onRealtimeAudio,
  sendRealtimeAudio,
  sendUserText,
  commitNow,
} from "./realtimeClient.ts";
import { upsamplePCM16Buffer, writeWavFile } from "./upsample.ts";

import ffmpeg from "fluent-ffmpeg";
// import puppeteer from 'puppeteer-extra'
// import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { getStream, launch } from "puppeteer-stream";

import {
  MAX_INTERVAL,
  MEET_BOT_MAX_DURATION,
  MIN_AUDIO_CHUNK_LENGTH,
  MIN_SILENCE_DURATION,
  SILENCE_THRESHOLD,
  ENABLE_FULL_AUDIO_ACCUMULATION,
} from "./constants.ts";
import { env } from "./env.ts";
import state, { type Page } from "./state.ts";
import { stopAudioProcessing, stopMeetBot } from "./stop_meet_bot.ts";
import {
  batchAudioChunk,
  delay,
  isBufferSilent,
  monitorKickout,
  monitorSpeakers,
  openChatWindow,
  sendChatMessage,
  detectMeetingPlatform,
  transformZoomUrl,
  type MeetingPlatform,
} from "./utils.ts";
import { sendToWhisper } from "./whisper.ts";
import audioProcessor from "./audio-processor.ts";
import { joinGoogleMeet } from "./platforms/joinGoogleMeet.ts";
import { joinZoom } from "./platforms/joinZoom.ts";
import { enableStreamingMic } from "./micStreaming.ts";

let wasSpeaking = false;
let lastSpeechAt = Date.now();

const recordingsDir = "./recordings";
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
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

// Helper function to debug available elements
async function debugAvailableElements(page: Page, stepName: string) {
  try {
    const elements = await page.evaluate(() => {
      const allElements = document.querySelectorAll(
        "*[data-tid], input, button, a"
      );
      return Array.from(allElements)
        .slice(0, 20)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id,
          dataTid: el.getAttribute("data-tid"),
          ariaLabel: el.getAttribute("aria-label"),
          className: el.className,
          text: el.textContent?.slice(0, 50) || "",
        }));
    });
    console.log(
      `🔍 Debug ${stepName} - Available elements:`,
      JSON.stringify(elements, null, 2)
    );
  } catch (error) {
    console.error(`❌ Error debugging elements for ${stepName}:`, error);
  }
}

export async function pauseMeetBot() {
  if (state.isBotPaused) {
    console.log("⏸️ Bot is already paused.");
    return;
  }

  console.log("⏸️ Pausing meet bot...");
  state.isBotPaused = true;

  // 1. Stop the interval
  if (state.audioProcessingInterval) {
    clearInterval(state.audioProcessingInterval);
    state.audioProcessingInterval = null;
    console.log("🛑 Audio processing interval paused.");
  }

  // 2. Send the pause message
  if (state.page) {
    await sendChatMessage(state.page, "Recording paused");
  }

  // 3. Process any remaining audio before clearing
  console.log("🚀 Processing remaining audio before pause...");
  // The enhanced processor will handle any pending audio automatically
  console.log("🧹 Audio processing paused.");
}

export async function resumeMeetBot() {
  if (!state.isBotPaused) {
    console.log("❌ The bot is not paused, cannot resume.");
    return;
  }
  // Mark the bot as no longer paused
  state.isBotPaused = false;

  // If the bot is still considered "running," we re-start audio processing
  if (state.isBotRunning && !state.audioProcessingInterval) {
    // Recreate the same logic used when you first start audio processing
    console.log("▶️ Restarting audio processing interval...");
    startAudioProcessing();
  }

  // Send resumed message
  if (state.page) {
    await sendChatMessage(state.page, "Recording resumed");
  }
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

// ✅ **Browser-Side Audio Capture Fallback Implementation**
async function implementBrowserSideAudioCapture(page: Page, platform: string) {
  try {
    // Platform-specific sample rate configuration
    const targetSampleRate = platform === "zoom" ? 44100 : 16000;
    console.log(
      `🎵 Setting up browser-side audio capture for ${platform} (target sample rate: ${targetSampleRate} Hz)`
    );

    // ✅ send the audio to realtime api
    try {
      await page.exposeFunction(
        "handleRealAudioChunk",
        (audioChunk: number[], browserSampleRate: number) => {
          const uint8 = new Uint8Array(audioChunk);
          // ✅ tell the sender the true rate so it resamples 48k -> 16k
          sendRealtimeAudio(uint8.buffer, browserSampleRate);
          console.log(
            `✅ Fallback: Sent ${uint8.byteLength} bytes to Realtime @ ${browserSampleRate} Hz`
          );
        }
      );
      console.log(
        "✅ Fallback: handleRealAudioChunk function exposed to browser"
      );
    } catch (exposeError) {
      console.log(
        "ℹ️ Fallback: handleRealAudioChunk already exposed, using existing function"
      );
    }

    // ✅ **Execute Browser-Side Audio Capture**
    const audioResult = await Promise.race([
      page.evaluate((targetSampleRate) => {
        return new Promise((resolve) => {
          const diagnostics: string[] = [];
          diagnostics.push("🔥 FALLBACK: Browser-side audio capture started");

          let audioSetupSuccess = false;
          let audioChunkCount = 0;

          try {
            const audioContext = new AudioContext({ sampleRate: 48000 });
            diagnostics.push(
              `🔊 Fallback: AudioContext created with sample rate: ${audioContext.sampleRate} Hz (target: ${targetSampleRate} Hz)`
            );

            // Try to find audio/video elements first
            const audioElements = document.querySelectorAll("audio, video");
            diagnostics.push(
              `📊 Fallback: Found ${audioElements.length} audio/video elements`
            );

            if (audioElements.length > 0) {
              audioElements.forEach((element, index) => {
                try {
                  let source:
                    | MediaElementAudioSourceNode
                    | MediaStreamAudioSourceNode
                    | null = null;

                  if ((element as any).srcObject) {
                    source = audioContext.createMediaStreamSource(
                      (element as any).srcObject
                    );
                    diagnostics.push(
                      `✅ Fallback: Created MediaStream source for element ${index}`
                    );
                  } else if ((element as any).src) {
                    source = audioContext.createMediaElementSource(
                      element as HTMLMediaElement
                    );
                    diagnostics.push(
                      `✅ Fallback: Created MediaElement source for element ${index}`
                    );
                  }

                  if (source) {
                    const processor = audioContext.createScriptProcessor(
                      4096,
                      2,
                      2
                    );
                    const gainNode = audioContext.createGain();
                    gainNode.gain.value = 2.0;

                    processor.onaudioprocess = (event) => {
                      const inputData = event.inputBuffer.getChannelData(0);
                      let sum = 0;
                      for (let i = 0; i < inputData.length; i++) {
                        sum += inputData[i] * inputData[i];
                      }
                      const rms = Math.sqrt(sum / inputData.length);
                      const audioLevel = rms * 100;

                      if (audioLevel > 0.005) {
                        const int16Array = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                          int16Array[i] = Math.max(
                            -32768,
                            Math.min(32767, inputData[i] * 32768)
                          );
                        }

                        if ((window as any).handleRealAudioChunk) {
                          (window as any).handleRealAudioChunk(
                            Array.from(new Uint8Array(int16Array.buffer)),
                            audioContext.sampleRate
                          );
                        }

                        audioChunkCount++;
                        if (audioChunkCount === 1) {
                          console.log(
                            `🎉 Fallback: First audio detected! Level: ${audioLevel.toFixed(
                              4
                            )}`
                          );
                          audioSetupSuccess = true;
                        }
                      }
                    };

                    source.connect(gainNode);
                    gainNode.connect(processor);
                    processor.connect(audioContext.destination);

                    diagnostics.push(
                      `✅ Fallback: Audio pipeline connected for element ${index}`
                    );
                  }
                } catch (elementError) {
                  diagnostics.push(
                    `❌ Fallback: Error with element ${index}: ${elementError}`
                  );
                }
              });
            } else {
              diagnostics.push("⚠️ Fallback: No audio elements found");
            }
          } catch (setupError) {
            diagnostics.push(`❌ Fallback: Audio setup error: ${setupError}`);
          }

          // Return result after short delay
          setTimeout(() => {
            resolve({
              success: audioSetupSuccess,
              diagnostics: diagnostics,
              audioChunkCount: audioChunkCount,
            });
          }, 3000);
        });
      }, targetSampleRate),
      // 10 second timeout
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Fallback audio setup timeout")),
          10000
        )
      ),
    ]);

    console.log(
      "✅ Fallback: Browser-side audio capture setup completed:",
      audioResult
    );

    if (audioResult && typeof audioResult === "object") {
      const result = audioResult as any;
      if (result.diagnostics && Array.isArray(result.diagnostics)) {
        result.diagnostics.forEach((diagnostic: string) => {
          console.log(`🔍 Fallback: ${diagnostic}`);
        });
      }
      console.log(
        `📊 Fallback: Setup result - Success: ${result.success}, Chunks: ${result.audioChunkCount}`
      );
    }
  } catch (error) {
    console.log("❌ Fallback: Browser-side audio capture setup failed:", error);
    console.log("⚠️ Fallback: Continuing without real-time audio capture");
  }
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

    onRealtimeAudio(async (ab: ArrayBuffer) => {
      const int16 = new Int16Array(ab);
      const modelOutRate = 24000; // ← key: model replies are 24 kHz

      // (optional) debug wav
      writeWavFile(
        Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength),
        modelOutRate,
        path.join(
          "recordings",
          `rt_reply_${Date.now()}_${modelOutRate / 1000}k.wav`
        )
      );

      // Tell the browser the *correct* source rate
      await state.page!.evaluate(
        ({ rate, samples }) => (window as any).enqueuePcmAt(rate, samples),
        { rate: modelOutRate, samples: Array.from(int16) }
      );

      console.log(`🔊 injected ${int16.length} samples @ ${modelOutRate} Hz`);
    });
    state.page = page;

    /*state.page.on("console", (msg) => {
      console.log("🧠 Browser log:", msg.text());
    });*/

    // ✅ Wait for browser to be fully ready
    console.log("⏳ Waiting for browser to be fully initialized...");
    await delay(2000);

    // ✅ Check browser and page state
    console.log("🔍 Browser state check:");
    console.log("  - Browser connected:", state.activeBrowser.connected);
    console.log("  - Page URL:", page.url());
    console.log("  - Browser version:", await state.activeBrowser.version());

    console.log("🎥 Starting recording...");

    const file = fs.createWriteStream(state.currentRecordingPath);

    const audioStream = new PassThrough();

    const audioSampleRate = meetingPlatform === "zoom" ? 44100 : 16000;
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
      if (humanVoiced) {
        wasSpeaking = true;
        lastSpeechAt = Date.now();
      }

      // only feed model when *you* are speaking and the agent is not
      if (humanVoiced && !isAgentSpeaking()) {
        sendRealtimeAudio(ab, 16000);
      }
    });

    // ✅ Enhanced recording setup with Docker compatibility and timeouts
    const attemptGetStream = async (
      options: any,
      timeoutMs: number = 10000
    ) => {
      return Promise.race([
        getStream(page, options),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Media stream timeout")), timeoutMs)
        ),
      ]);
    };

    try {
      console.log("🎬 Attempting to get media stream with 10s timeout...");

      // Try basic audio-only recording first (Docker compatible)
      const recordingOptions = {
        audio: true,
        video: false, // Disable video for Docker compatibility
      };

      console.log(
        "📱 Recording options:",
        JSON.stringify(recordingOptions, null, 2)
      );

      state.activeStream = await attemptGetStream(recordingOptions, 10000);
      console.log("✅ Media stream obtained successfully!");
    } catch (streamError) {
      console.error(
        "❌ Failed to get media stream:",
        streamError instanceof Error ? streamError.message : streamError
      );
      console.log(
        "🔄 Attempting quick fallback recording setup (5s timeout)..."
      );

      try {
        // Fallback: Try with minimal options and shorter timeout
        state.activeStream = await attemptGetStream(
          {
            audio: true,
            video: false,
          },
          5000
        );
        console.log("✅ Fallback media stream obtained!");
      } catch (fallbackError) {
        console.error(
          "❌ Fallback recording also failed:",
          fallbackError instanceof Error ? fallbackError.message : fallbackError
        );

        if (meetingPlatform === "zoom") {
          console.log(
            "⚠️ puppeteer-stream failed for Zoom - implementing browser-side audio capture fallback..."
          );
          console.log(
            "✅ Dummy stream created, will implement browser-side audio capture after joining..."
          );
          state.isUsingSimulatedAudio = true;
        } else {
          console.log(
            `⚠️ puppeteer-stream failed for ${meetingPlatform} - implementing browser-side audio capture fallback...`
          );
          console.log(
            "✅ Dummy stream created, will implement browser-side audio capture after joining..."
          );
          state.isUsingSimulatedAudio = true;
        }

        // Create a dummy stream to prevent further errors
        state.activeStream = new PassThrough();
      }
    }

    if (state.activeStream) {
      state.activeStream.pipe(file);
      state.activeStream.pipe(audioStream);
    }

    await delay();

    const context = state.activeBrowser.defaultBrowserContext();

    // ✅ **Grant Permissions for WebRTC & Media** (enhanced from your working code)
    await context.overridePermissions(transformedMeetUrl, [
      "camera",
      "microphone",
      "notifications",
    ]);

    // Additional permissions for Zoom domain (from your working code)
    if (meetingPlatform === "zoom") {
      await context.overridePermissions("https://zoom.us", [
        "camera",
        "microphone",
        "clipboard-read",
        "clipboard-write",
        "notifications",
      ]);
    }
    await page.setDefaultNavigationTimeout(120_000);
    await page.goto(transformedMeetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    // optional: give SPA a moment, then proceed
    await page.waitForSelector("body", { timeout: 60_000 });
    //await delay(); // short extra delay for UI to load

    // ✅ Route to appropriate joining logic based on platform
    if (meetingPlatform === "google-meet") {
      await joinGoogleMeet(page, transformedMeetUrl);
      //} else if (meetingPlatform === "teams") {
      //await joinTeams(page);
    } else if (meetingPlatform === "zoom") {
      await joinZoom(page);
    }

    // ✅ **Browser-Side Audio Capture Fallback** (for any platform when puppeteer-stream fails)

    if (state.isUsingSimulatedAudio) {
      console.log(
        `🎧 Implementing browser-side audio capture fallback for ${meetingPlatform}...`
      );
      await implementBrowserSideAudioCapture(page, meetingPlatform);
    }
    await openChatWindow(page);

    // ✅ **Start Monitoring Speaker Changes**
    monitorSpeakers(page);
    monitorKickout(page);

    console.log("📡 Bot is now listening to the meeting...");
    //await delay();
    /*
    const sr = 48000,
      f = 440,
      dur = 0.6;
    const tone48 = Array.from({ length: Math.floor(sr * dur) }, (_, i) =>
      Math.round(Math.sin((2 * Math.PI * f * i) / sr) * 32767)
    );
    await state.page.evaluate(
      ({ rate, samples }) => (window as any).enqueuePcmAt(rate, samples),
      { rate: sr, samples: tone48 }
    );
    */
    // Kick off the interview via a hard-coded user message
    sendUserText(
      "Please begin the interview now by stating the scenario. Start with the simple web app to display cat pictures."
    );
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
