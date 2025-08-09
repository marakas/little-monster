import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { PassThrough } from "stream";

ffmpeg.setFfmpegPath(ffmpegPath!);

// 1) configure your agent
const agent = new RealtimeAgent({
  name: "Assistant",
  instructions:
    "We are doing an assessment for a System design interviews, you are playing the role of the interviewer, I am the interviewee. Speak to me in English. You should start the conversation, please kick off by stating the scenario: you want me to design a simple web application that can display pictures of cats. You should listen and try to understand the design that the user is describing.  Don't give any hints outside of the scenario unless asked, don't be too chatty, don't give away too much too quickly.  Allow the user to question you and discover the functional and non-functinonal requiremtents (this is actually part of what they will be assessed on).  Here are the non-functional requirements, if you are asked you can explain any or all of the following extra criteria: the system should be available globally, the most important thing is to load images quickly.  There will be approximately 20 million users so the system needs to be highly available and highly performant.",
});

// 2) open a WebSocket-based session
const wsSession = new RealtimeSession(agent, {
  transport: "websocket",
  model: "gpt-4o-realtime-preview-2025-06-03",
});

let playCb: ((buffer: ArrayBuffer) => void) | undefined;
export function onRealtimeAudio(cb: (buffer: ArrayBuffer) => void) {
  playCb = cb;
}
wsSession.on("audio", (evt) => {
  if (playCb) playCb(evt.data);
});

export async function initRealtime(apiKey: string) {
  await wsSession.connect({ apiKey });
  wsSession.on("audio", (event) => {
    console.log("received audio chunk:", event.data);
  });
}

/**
 * Send raw PCM16 mono audio to the Realtime API.
 * If input is already 16 kHz s16le → send directly.
 * Otherwise we resample to 16 kHz s16le via ffmpeg.
 */
export function sendRealtimeAudio(data: ArrayBuffer, inputSampleRate = 16000) {
  if (inputSampleRate === 16000) {
    // zero-copy slice
    const buf = Buffer.from(data);
    wsSession.sendAudio(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    return;
  }

  const MAX_CHUNK_SIZE = 8192;
  const input = new PassThrough();
  const output = new PassThrough();
  input.end(Buffer.from(data));

  ffmpeg(input)
    .inputOptions(["-f", "s16le", "-ar", String(inputSampleRate), "-ac", "1"])
    .audioFrequency(16000)
    .audioChannels(1)
    .audioCodec("pcm_s16le")
    .format("s16le")
    .on("error", (err) => console.error("Resample error:", err.message))
    .pipe(output);

  let buffer = Buffer.alloc(0);
  output.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= MAX_CHUNK_SIZE) {
      const piece = buffer.slice(0, MAX_CHUNK_SIZE);
      wsSession.sendAudio(
        piece.buffer.slice(
          piece.byteOffset,
          piece.byteOffset + piece.byteLength
        )
      );
      buffer = buffer.slice(MAX_CHUNK_SIZE);
    }
  });
  output.on("end", () => {
    if (buffer.length > 0) {
      wsSession.sendAudio(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      );
    }
  });
}

// (optional) simple linear upsampler kept as utility
export function upsamplePCM16Linear(
  input: Int16Array,
  inputRate = 16000,
  outputRate = 48000
): Int16Array {
  const factor = outputRate / inputRate;
  const outputLength = Math.floor(input.length * factor);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i / factor;
    const li = Math.floor(pos);
    const ri = Math.min(li + 1, input.length - 1);
    const w = pos - li;
    output[i] = (1 - w) * input[li] + w * input[ri];
  }
  return output;
}
