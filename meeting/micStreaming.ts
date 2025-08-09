// micStreaming.ts  – drop-in replacement
import type { Page as PPage } from "puppeteer-core"; // or puppeteer
type Samples = number[];

export async function enableStreamingMic(page: PPage) {
  await page.evaluateOnNewDocument(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => console.log(s.getAudioTracks()[0].getSettings()));

    const pcmRate = 48000;
    const ctx = new AudioContext({ sampleRate: 48000 });
    const realRate = ctx.sampleRate;
    const ratio = pcmRate / realRate;

    const queue: number[] = [];
    (window as any).enqueuePcm = (s: number[]) => queue.push(...s);

    ctx.resume().catch(() => {});

    const proc = ctx.createScriptProcessor(4096, 1, 1);

    proc.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < out.length; i++) {
        out[i] = i < queue.length ? queue[i] / 32768 : 0; // 1-to-1 copy
      }
      queue.splice(0, out.length); // consume same amount
    };

    const dest = ctx.createMediaStreamDestination();

    // Add gain to boost audio for Meet
    const gain = ctx.createGain();
    gain.gain.value = 3.0;
    proc.connect(gain);
    gain.connect(dest);
    gain.connect(ctx.destination);

    // --- 🧪 DEBUG: Add logging for getUserMedia calls
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );
    navigator.mediaDevices.getUserMedia = async (c: any) => {
      console.log("📞 getUserMedia called with:", c);

      if (c?.audio) {
        console.log("🎤 Returning fake mic stream. ID:", dest.stream.id);
        return dest.stream;
      }

      return origGetUserMedia(c);
    };

    // --- 🧪 DEBUG: Override enumerateDevices
    const origEnumerate = navigator.mediaDevices.enumerateDevices.bind(
      navigator.mediaDevices
    );
    navigator.mediaDevices.enumerateDevices = async () => {
      const list = await origEnumerate();
      console.log("🔍 enumerateDevices result:", list);

      // Just return real list for now (optionally spoof later)
      return list;
    };
    const track = dest.stream.getAudioTracks()[0];
    console.log(
      "🎛️ fake-mic track settings:",
      JSON.stringify(track.getSettings())
    );
  });
}
