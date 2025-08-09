import * as fs from "node:fs";
import * as path from "node:path";

import AWS from "aws-sdk";

import { runCleanup } from "./cleanup.ts";
import { completeMeeting } from "./dynamo.ts";
import { env } from "./env.ts";
import state from "./state.ts";
import {
  sendToWhisper,
  processFullAccumulatedAudio,
  cleanupTranscriptionHallucinations,
} from "./whisper.ts";

// Initialize AWS S3
const s3 = new AWS.S3({
  endpoint: env.S3_ENDPOINT,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  region: env.AWS_REGION,
  s3ForcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// Helper delay function
const delay = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

// ✅ **Stop Audio Processing**
export function stopAudioProcessing() {
  if (state.audioProcessingInterval) {
    console.log("🔄 Stopping audioProcessingInterval:");
    clearInterval(state.audioProcessingInterval);
    state.audioProcessingInterval = null;
    console.log("⏹️ Audio processing interval stopped.");
  } else {
    console.log("⚠️ No active audio processing interval found.");
  }

  // ✅ **Stop Modal Suppression**
  if (state.modalSuppressionInterval) {
    console.log("🔄 Stopping modalSuppressionInterval:");
    clearInterval(state.modalSuppressionInterval);
    state.modalSuppressionInterval = null;
    console.log("⏹️ Modal suppression interval stopped.");
  }
}

// ✅ **Stop Meet Bot Function**
export async function stopMeetBot() {
  console.log("🛑 Stop Meet Bot called.🛑 ");

  if (state.isClosing) {
    console.log("⚠️ Bot is already stopping. Ignoring duplicate call.");
    return;
  }

  state.isClosing = true; // **Set flag to prevent duplicate stops**

  // ✅ **Stop all monitoring immediately** by setting isBotRunning to false early
  console.log("🛑 Stopping all monitoring functions...");
  state.isBotRunning = false;

  try {
    if (state.stopTimeout) {
      clearTimeout(state.stopTimeout);
      state.stopTimeout = null;
    }

    console.log("⏹️ Calling stopAudioProcessing...");
    stopAudioProcessing();

    // ✅ Process accumulated audio if in full accumulation mode
    if (state.isFullAccumulationMode && state.fullAudioAccumulator.length > 0) {
      console.log("🧪 Processing full accumulated audio before exit...");
      await processFullAccumulatedAudio();
    } else if (state.audioBuffer.length > 0) {
      // ✅ Ensure the last audio chunk is sent to Whisper **before finalizing** (standard mode)
      console.log("🚀 Sending final audio chunk to Whisper before exit...");
      // Pass 16000 Hz as default for final processing
      //await sendToWhisper(state.audioBuffer, 0, false, 16000);
      state.audioBuffer = Buffer.alloc(0);
    }

    // ✅ Mark as finalizing **after sending the last chunk**
    state.isFinalizing = true;

    // ✅ Wait for all pending Whisper transcriptions to complete
    console.log(
      `⏳ Waiting for pending transcriptions (${state.pendingTranscriptions})...`
    );
    while (state.pendingTranscriptions > 0) {
      await delay(1000);
    }
    console.log("✅ All Whisper transcriptions completed.");

    // 🧹 Clean up transcription hallucinations and repetitions
    if (state.transcriptionLog.length > 0) {
      await cleanupTranscriptionHallucinations();
    }

    // Clear active speaker
    state.currentSpeaker = "User";

    // ✅ Stop media stream (Prevents further recording)
    if (state.activeStream) {
      console.log("⏹️ Stopping media stream...");
      state.activeStream.destroy();
      state.activeStream = null;
    }

    // ✅ Stop audio simulation if active
    if (state.audioSimulationCleanup) {
      console.log("⏹️ Stopping audio simulation...");
      state.audioSimulationCleanup();
      state.audioSimulationCleanup = null;
    }

    // ✅ Stop FFmpeg process
    if (state.activeProcess && typeof state.activeProcess.kill === "function") {
      console.log("⏹️ Stopping FFmpeg process...");
      state.activeProcess.kill("SIGTERM");
      state.activeProcess = null;
    }

    // ✅ Ensure all Puppeteer operations are finished before closing
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // ✅ Close the browser
    try {
      if (state.activeBrowser) {
        console.log("⏹️ Closing browser...");
        await state.activeBrowser.close();
        state.activeBrowser = null;
      }
    } catch (err) {
      console.warn(
        "⚠️ Browser was already closed or failed to close:",
        err instanceof Error ? err.message : err
      );
    }

    // ✅ Upload final video and transcription log
    try {
      // ✅ Upload final video
      if (
        state.currentRecordingPath &&
        fs.existsSync(state.currentRecordingPath)
      ) {
        const videoKey = `meetings/${state.meetingId}/video/${path.basename(
          state.currentRecordingPath
        )}`;
        console.log(`📤 Uploading recording to S3: ${videoKey}`);
        await uploadToS3(state.currentRecordingPath, videoKey);
      }

      // ✅ Upload transcription log
      const transcriptionFiles = [
        { path: state.transcriptionLogPath, name: "cleaned transcription" },
      ];

      for (const file of transcriptionFiles) {
        if (file.path && fs.existsSync(file.path)) {
          const logKey = `meetings/${
            state.meetingId
          }/transcriptions/${path.basename(file.path)}`;
          console.log(`📤 Uploading ${file.name} to S3: ${logKey}`);
          await uploadToS3(file.path, logKey);
        }
      }

      console.log(
        `✅ Successfully uploaded session files for meeting ${state.meetingId}`
      );
    } catch (uploadErr) {
      console.error("❌ Error uploading session files to S3:", uploadErr);
    }

    // ✅ Clean up local file store
    if (state.sessionDir) {
      fs.rmSync(state.sessionDir, { recursive: true, force: true });
    }

    // ✅ Reset transcription log for next session
    state.transcriptionLog = [];

    // ✅ Mark meeting as complete in DynamoDB
    if (state.meetingId) {
      await completeMeeting(state.meetingId);
    }

    // ✅ Resolve the promise so `startMeetBot()` can finish
    if (state.meetingId) {
      state.activeRecordings[state.meetingId]?.(); // Resolves the `await startMeetBot()` in `pollSQS()`
      state.activeRecordings[state.meetingId] = null; // Cleanup

      await runCleanup(state.meetingId);
    }
    console.log(`✅ MeetBot successfully stopped for ${state.meetingId}.`);
  } catch (err) {
    console.error(
      "❌ Error while stopping Meet Bot:",
      err instanceof Error ? err.message : err
    );
  } finally {
    state.transcriptionLog = []; // clear transcription log when finished
    state.isBotRunning = false; // Reset flags after finished
    state.isFinalizing = false;
    state.isBotPaused = false;
    state.isClosing = false;
    state.meetingId = null;
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
      state.heartbeatInterval = null;
    }
  }
}

// New helper to upload a file to S3
async function uploadToS3(filePath: string, key: string) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    fileStream.on("error", (err) => reject(err));

    s3.upload(
      {
        Bucket: env.MEET_BOT_S3_BUCKET,
        Key: key,
        Body: fileStream,
      },
      (s3Err, data) => {
        if (s3Err) return reject(s3Err);
        resolve(data);
      }
    );
  });
}
