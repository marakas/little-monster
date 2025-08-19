// pythonBridge.ts
import { spawn } from "node:child_process";
import * as path from "node:path";

export interface VisionResult {
  summary: string;
  whiteboard?: {
    state: "none" | "blank" | "has_content" | "unknown";
    app?: string;
  };
  diagram?: any;
}
const DEBUG = process.env.VISION_DEBUG === "1";

const PYTHON_BIN = process.env.PYTHON_BIN || "/home/pulseuser/venv/bin/python";
const SCRIPT = path.resolve("py/analyze_cli.py");

export function analyzeScreenshot(imagePath: string): Promise<VisionResult> {
  return new Promise((resolve, reject) => {
    const args = [SCRIPT, "--image", imagePath];
    if (DEBUG) {
      console.log(`[vision] spawning: ${PYTHON_BIN} ${args.join(" ")}`);
    }

    const proc = spawn(PYTHON_BIN, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }, // ensures OPENAI_API_KEY etc. are present
    });

    let out = "";
    let err = "";

    proc.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      if (DEBUG) console.log(`[vision][stdout] ${s.trim()}`);
    });

    proc.stderr.on("data", (d) => {
      const s = d.toString();
      err += s;
      console.error(`[vision][stderr] ${s.trim()}`);
    });

    // helpful for ENOENT or permission errors
    proc.on("error", (e) => {
      console.error("[vision] spawn error:", e);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(out);
          resolve(parsed as VisionResult);
        } catch (e) {
          reject(new Error(`Python returned non-JSON: ${out}\n${err}`));
        }
      } else {
        reject(new Error(`Python exited with code ${code}: ${err || out}`));
      }
    });
  });
}
