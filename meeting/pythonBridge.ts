// pythonBridge.ts
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

export interface LiveAssessment {
  scores?: Array<{ category: string; score: number; comment: string }>;
  top_gaps?: string[];
  suggested_next_question?: string;
}

export interface VisionResult {
  summary: string;
  whiteboard?: {
    state: "none" | "blank" | "has_content" | "unknown";
    app?: string;
  };
  diagram?: any;
  live?: LiveAssessment | null;
}

const DEBUG = process.env.VISION_DEBUG === "1";
const PYTHON_BIN = process.env.PYTHON_BIN || "/home/pulseuser/venv/bin/python";
const SCRIPT = path.resolve("py/analyze_cli.py");

async function writeTmp(name: string, content: string) {
  const p = path.join(os.tmpdir(), `${name}-${Date.now()}.txt`);
  await fs.writeFile(p, content, "utf8");
  return p;
}

export async function analyzeSnapshot(opts: {
  imagePath: string;
  transcriptText?: string;
  requirementsText?: string;
}): Promise<VisionResult> {
  const args = [SCRIPT, "--image", opts.imagePath];
  let txPath: string | undefined;
  let reqPath: string | undefined;

  try {
    if (opts.transcriptText) {
      txPath = await writeTmp("tx", opts.transcriptText);
      args.push("--transcript", txPath);
    }
    if (opts.requirementsText) {
      reqPath = await writeTmp("req", opts.requirementsText);
      args.push("--requirements", reqPath);
    }

    if (DEBUG) console.log(`[vision] spawn: ${PYTHON_BIN} ${args.join(" ")}`);

    const proc = spawn(PYTHON_BIN, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let out = "",
      err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));

    return await new Promise<VisionResult>((resolve, reject) => {
      proc.on("close", async (code) => {
        try {
          if (txPath) await fs.unlink(txPath).catch(() => {});
          if (reqPath) await fs.unlink(reqPath).catch(() => {});
        } finally {
          if (code === 0) {
            try {
              resolve(JSON.parse(out) as VisionResult);
            } catch (e) {
              reject(new Error(`Python returned non-JSON: ${out}\n${err}`));
            }
          } else {
            reject(new Error(`Python exited with code ${code}: ${err || out}`));
          }
        }
      });
    });
  } catch (e) {
    throw e;
  }
}

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
