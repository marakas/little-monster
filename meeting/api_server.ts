// api_server.ts
import "dotenv/config";
import express from "express";

import { BOT_ID } from "./constants.ts";
import { startMeetBot } from "./meetbot.ts";
import state from "./state.ts";
import { stopMeetBot } from "./stop_meet_bot.ts";

const app = express();
app.use(express.json());

// Health
app.get("/", (_req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Local status (no MQ)
app.get("/local/status", (_req, res) => {
  res.json({
    running: state.isBotRunning,
    paused: state.isBotPaused,
    meetingId: state.meetingId,
  });
});

// Local start (single instance)
app.post("/local/start", async (req, res) => {
  const { meetingId, meetUrl, lessonId, userId } = req.body || {};
  if (!meetingId || !meetUrl || !lessonId || !userId) {
    return res
      .status(400)
      .json({ error: "meetingId, meetUrl, lessonId and userId are required" });
  }
  if (state.isBotRunning) {
    return res.status(409).json({ error: "bot already running" });
  }

  try {
    await startMeetBot(meetUrl, meetingId, lessonId, userId);
    return res.json({ ok: true });
  } catch (e) {
    console.error("startMeetBot failed:", e);
    return res.status(500).json({ error: "failed to start" });
  }
});

// Local stop
app.post("/local/stop", async (_req, res) => {
  if (!state.isBotRunning) return res.json({ ok: true, note: "not running" });
  try {
    await stopMeetBot();
    return res.json({ ok: true });
  } catch (e) {
    console.error("stopMeetBot failed:", e);
    return res.status(500).json({ error: "failed to stop" });
  }
});

// Graceful shutdown (no MQ cleanup needed)
process.on("SIGINT", async () => {
  console.log(`⚠️ [${BOT_ID}] Caught SIGINT. Exiting...`);
  try {
    if (state.isBotRunning) {
      await stopMeetBot();
    } else {
      // Best effort: close any dangling resources
      try {
        if (
          state.activeProcess &&
          typeof state.activeProcess.kill === "function"
        ) {
          state.activeProcess.kill("SIGTERM");
        }
      } catch {}
      try {
        await state.activeBrowser?.close();
      } catch {}
      state.isBotRunning = false;
    }
  } catch (err) {
    console.error("❌ Error during shutdown:", err);
  } finally {
    process.exit(0);
  }
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 [${BOT_ID}] API Server running on port ${PORT}`)
);
