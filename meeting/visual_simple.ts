// visual_simple.ts
import * as fs from "node:fs";
import * as path from "node:path";
import state, { type Page } from "./state.ts";

let screenshotInterval: NodeJS.Timeout | null = null;
let screenshotDir: string | null = null;

/**
 * Start very simple periodic screenshots of the current viewport.
 * @param page Puppeteer Page
 * @param fps Frames per second (e.g., 0.5 = one every 2s)
 */
export async function startSimpleScreenshots(page: Page, fps = 0.5) {
  if (screenshotInterval) return;
  if (!state.sessionDir) throw new Error("sessionDir not set yet");

  const dir = path.join(state.sessionDir, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  screenshotDir = dir;

  const periodMs = Math.max(250, Math.floor(1000 / Math.max(0.1, fps)));

  screenshotInterval = setInterval(async () => {
    try {
      const ts = Date.now();
      const filePath = path.join(dir, `ss_${ts}.jpg`);
      await page.screenshot({
        path: filePath,
        type: "jpeg",
        quality: 80, // small + good enough
        fullPage: false, // just the current viewport
      });
      // Optional: uncomment if you want logs
      // console.log(`📸 Saved ${filePath}`);
    } catch {
      /* ignore single-shot errors */
    }
  }, periodMs);

  console.log(`📸 Simple screenshots started → ${dir} @ ~${fps} fps`);
}

export function stopSimpleScreenshots() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
    console.log("🧹 Simple screenshots stopped");
  }
}
export function getScreenshotDir() {
  return screenshotDir;
}
