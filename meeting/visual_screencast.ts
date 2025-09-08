import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import type { Page } from "./state.ts";
import { pathToFileURL } from "node:url";

let screenshotDir: string | null = null;
let worker: Worker | null = null;
let stopFn: null | (() => Promise<void>) = null;

export function getScreenshotDir() {
  return screenshotDir;
}

/**
 * Stream JPEG frames from Chrome via CDP Screencast and write them on a worker.
 * Throttled by fps (frames actually saved per second).
 */
export async function startScreencastCapture(
  page: Page,
  sessionDir: string,
  opts?: {
    fps?: number; // saved frames per second (default 0.33 ≈ 1 frame/3s)
    quality?: number; // JPEG 1..100 (default 60)
    maxWidth?: number; // downscale to reduce cost
    maxHeight?: number;
  }
) {
  if (process.env.VISION_ENABLED !== "1") {
    console.log("📸 Vision disabled – not starting screencast");
    return;
  }
  const fps = Math.max(0.1, opts?.fps ?? 0.33);
  const minIntervalMs = Math.floor(1000 / fps);
  const quality = Math.min(100, Math.max(1, opts?.quality ?? 60));
  const maxWidth = opts?.maxWidth ?? 1280;
  const maxHeight = opts?.maxHeight ?? 720;

  const dir = path.join(sessionDir, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  screenshotDir = dir;

  const workerPath = path.resolve(process.cwd(), "visual_writer.worker.ts");
  worker = new Worker(pathToFileURL(workerPath), {
    execArgv: ["--experimental-strip-types"],
  });
  const client = await page.target().createCDPSession();
  await client.send("Page.enable");

  let lastSaved = 0;
  let running = true;

  client.on("Page.screencastFrame", async (evt: any) => {
    // ACK immediately to keep Chrome from back-pressuring us
    try {
      // @ts-ignore
      await client.send("Page.screencastFrameAck", {
        sessionId: evt.sessionId,
      });
    } catch {
      /* ignore */
    }
    if (!running) return;

    const now = Date.now();
    if (now - lastSaved < minIntervalMs) return;
    lastSaved = now;

    // Offload write to worker (no base64 decode on main thread)
    worker?.postMessage({ type: "save", dir, ts: now, b64: evt.data });
  });

  // Start screencast (Chrome will send steady JPEG frames)
  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality, // 1..100
    maxWidth,
    maxHeight,
    // everyNthFrame can be set, but wall-clock throttling above is more predictable
  });

  stopFn = async () => {
    running = false;
    try {
      await client.send("Page.stopScreencast");
    } catch {}
    try {
      await client.detach();
    } catch {}
    if (worker) {
      await new Promise((res) => {
        worker!.once("exit", res);
        worker!.postMessage({ type: "stop" });
        // in case it's busy, give it a gentle nudge after a moment
        setTimeout(() => {
          try {
            worker!.terminate();
          } catch {}
        }, 1500);
      });
    }
    worker = null;
  };

  console.log(
    `📸 Screencast started → ${dir} (quality=${quality}, ${maxWidth}x${maxHeight}, ~${fps} fps)`
  );
}

export async function stopScreencastCapture() {
  if (stopFn) {
    const s = stopFn;
    stopFn = null;
    await s();
    console.log("🧹 Screencast stopped");
  }
}
