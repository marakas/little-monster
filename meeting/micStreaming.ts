// micStreaming.ts — revert to the choppy-but-working ScriptProcessor path
// - 48k internal graph
// - supports enqueuePcmAt(rate, Int16[])
// - no preroll / minimal buffering (this is why it’s choppy, but it *will* output)

import type { Page as PPage } from "puppeteer-core";

type Samples = number[];

export async function enableStreamingMic(page: PPage) {
  await page.evaluateOnNewDocument(() => {
    // Expect 48k Int16 by default, but handle other rates via enqueuePcmAt()
    const DEFAULT_INPUT_RATE = 48000;

    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC({ sampleRate: DEFAULT_INPUT_RATE });
    const realRate = ctx.sampleRate;

    // --- Ring buffer over a plain array with an index to avoid O(n) shifts
    let queue: number[] = []; // Float32 normalized [-1, 1]
    let base = 0; // logical start index
    let readPtr = 0; // fractional read pointer relative to 'base'
    let inputRate = DEFAULT_INPUT_RATE; // current enqueue sample rate

    // Backpressure limit: keep at most ~5s of audio
    const MAX_BUFFER_SECONDS = 5;

    // Public API: enqueue 48k Int16 by default
    (window as any).enqueuePcm = (s: number[]) => {
      if (!Array.isArray(s) || s.length === 0) return;
      // Convert Int16 -> Float32 once, store normalized
      for (let i = 0; i < s.length; i++) queue.push((s[i] as number) / 32768);
      // Trim if buffer grows too large
      const maxSamples = Math.floor(inputRate * MAX_BUFFER_SECONDS);
      const buffered = queue.length - base;
      if (buffered > maxSamples) {
        base = queue.length - maxSamples;
        // Compact occasionally to cap memory
        if (base > 32768 && base > queue.length / 2) {
          queue = queue.slice(base);
          base = 0;
        }
      }
    };

    // Public API: enqueue at an explicit sample rate
    (window as any).enqueuePcmAt = (rate: number, s: number[]) => {
      if (typeof rate === "number" && rate > 0) inputRate = Math.floor(rate);
      (window as any).enqueuePcm(s);
    };

    // Optional helpers
    (window as any).clearPcm = () => {
      queue = [];
      base = 0;
      readPtr = 0;
    };
    (window as any).getFakeMicStats = () => ({
      ctxRate: realRate,
      inputRate,
      queuedSamples: Math.max(0, queue.length - base),
      secondsQueued: Math.max(0, queue.length - base) / Math.max(1, inputRate),
    });

    ctx.resume().catch(() => {});

    const proc = ctx.createScriptProcessor(4096, 1, 1);

    proc.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      const step = inputRate / realRate; // resample ratio
      const qLen = queue.length;

      for (let i = 0; i < out.length; i++) {
        const pos = base + readPtr;
        const i0 = pos | 0;
        const frac = pos - i0;

        const a = i0 < qLen ? queue[i0] : 0;
        const b = i0 + 1 < qLen ? queue[i0 + 1] : a;

        // Linear interpolation; fine for voice
        out[i] = a + (b - a) * frac;

        readPtr += step;
      }

      // Drop whole samples we've "passed" in this callback
      const drop = readPtr | 0;
      if (drop > 0) {
        base += drop;
        readPtr -= drop;

        // Periodically compact to keep memory tidy
        if (base > 32768 && base > qLen / 2) {
          queue = queue.slice(base);
          base = 0;
        }
      }
    };

    // Create the fake mic stream
    const dest = ctx.createMediaStreamDestination();

    // Feed fake mic
    proc.connect(dest);

    // Keep the graph alive but inaudible (prevents echo/auto-mute issues)
    const keepAlive = ctx.createGain();
    keepAlive.gain.value = 0.0001; // essentially silent
    proc.connect(keepAlive);
    keepAlive.connect(ctx.destination);

    // --- Override getUserMedia to hand out our fake mic
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );
    navigator.mediaDevices.getUserMedia = async (constraints: any) => {
      try {
        console.log("📞 getUserMedia called with:", constraints);
      } catch {}
      if (constraints && constraints.audio) {
        console.log("🎤 Returning fake mic stream. ID:", dest.stream.id);
        return dest.stream;
      }
      return origGetUserMedia(constraints);
    };

    // --- (Optional) enumerateDevices passthrough, just for debugging
    const origEnumerate = navigator.mediaDevices.enumerateDevices.bind(
      navigator.mediaDevices
    );
    navigator.mediaDevices.enumerateDevices = async () => {
      const list = await origEnumerate();
      try {
        console.log("🔍 enumerateDevices result:", list);
      } catch {}
      return list;
    };

    const track = dest.stream.getAudioTracks()[0];
    console.log(
      "🎛️ fake-mic ready",
      JSON.stringify({
        ctxSampleRate: realRate,
        expectedInputRate: DEFAULT_INPUT_RATE,
        trackSettings: track?.getSettings?.() || {},
      })
    );
  });
}
