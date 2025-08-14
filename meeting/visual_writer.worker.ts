import { parentPort } from "node:worker_threads";
import * as fs from "node:fs/promises";
import * as path from "node:path";

if (!parentPort) throw new Error("Must be run as a worker");

type Msg =
  | { type: "save"; dir: string; ts: number; b64: string }
  | { type: "stop" };

let stopping = false;

// simple sequential queue to avoid disk contention
const q: Msg[] = [];
let active = false;

async function drain() {
  if (active || stopping) return;
  active = true;
  while (q.length && !stopping) {
    const m = q.shift()!;
    if (m.type === "save") {
      try {
        const file = path.join(m.dir, `sc_${m.ts}.jpg`);
        const buf = Buffer.from(m.b64, "base64");
        await fs.writeFile(file, buf);
      } catch (e) {
        // keep failures noisy but non-fatal to the main thread
        console.error("[vision-writer] write error:", (e as Error).message);
      }
    } else if (m.type === "stop") {
      stopping = true;
      break;
    }
  }
  active = false;
}

parentPort.on("message", (m: Msg) => {
  if (stopping) return;
  q.push(m);
  // schedule drain without blocking sender
  setImmediate(drain);
});
