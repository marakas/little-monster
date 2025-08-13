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

const wsSession = new RealtimeSession(agent, {
  transport: "websocket",
  model: "gpt-4o-realtime-preview-2025-06-03",
  config: {
    inputAudioFormat: "pcm16", // ✅ string literal, not an object
    outputAudioFormat: "pcm16", // ✅ string literal
    turnDetection: {
      type: "semantic_vad",
      eagerness: "medium",
      createResponse: true,
      interruptResponse: true,
    },
  },
});

wsSession.on("error", (e) =>
  console.error("Realtime session error:", JSON.stringify(e, null, 2))
);

let playCb: ((buffer: ArrayBuffer) => void) | undefined;
export function onRealtimeAudio(cb: (buffer: ArrayBuffer) => void) {
  playCb = cb;
}
let audioListenerBound = false;
// --- speaking detector based on chunk energy ---
function chunkHasVoice(ab: ArrayBuffer): boolean {
  const v = new Int16Array(ab);
  if (v.length === 0) return false;
  // Subsample to keep it cheap
  let sum = 0,
    n = 0;
  for (let i = 0; i < v.length; i += 16) {
    sum += v[i] * v[i];
    n++;
  }
  const rms = Math.sqrt(sum / Math.max(1, n)); // ~0..32767
  return rms > 200; // tune if needed (100–500 typical)
}

let agentSpeaking = false;
let speakingTimer: NodeJS.Timeout | null = null;
export function isAgentSpeaking() {
  return agentSpeaking;
}
function markAgentSpeaking() {
  agentSpeaking = true;
  if (speakingTimer) clearTimeout(speakingTimer);
  // consider “done” if no *voiced* chunks for 200ms
  speakingTimer = setTimeout(() => {
    agentSpeaking = false;
  }, 200);
}

export async function initRealtime(apiKey: string) {
  if (!audioListenerBound) {
    wsSession.on("audio", (event) => {
      if (chunkHasVoice(event.data)) markAgentSpeaking(); // 👈 only on voiced audio
      playCb?.(event.data);
    });
    audioListenerBound = true;
  }
  await wsSession.connect({ apiKey });
}

/* ---------- SILENCE-DRIVEN COMMIT (no-ops if control path unavailable) ---------- */
let silenceTimer: NodeJS.Timeout | null = null;
function scheduleCommit() {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    // Tell the server to process what we've sent and create a reply
    wsSession.transport.sendEvent({ type: "input_audio_buffer.commit" });
    wsSession.transport.sendEvent({
      type: "response.create",
      response: { modalities: ["audio", "text"] },
    });
  }, 600);
}

const INPUT_RATE = 16000; // s16le mono
const MIN_COMMIT_MS = 120; // a hair > 100ms server requirement
const MIN_COMMIT_BYTES = Math.floor((INPUT_RATE * 2 * MIN_COMMIT_MS) / 1000);
let bytesSinceCommit = 0;

function canCommit() {
  return bytesSinceCommit >= MIN_COMMIT_BYTES;
}
function resetCommitBudget() {
  bytesSinceCommit = 0;
}

export function commitNow() {
  if (!canCommit()) return; // ← prevents input_audio_buffer_commit_empty
  wsSession.transport.sendEvent({ type: "input_audio_buffer.commit" });
  bytesSinceCommit = 0;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

function send16k(buf: Buffer) {
  bytesSinceCommit += buf.length; // track bytes for commit guard
  wsSession.sendAudio(bufferToArrayBuffer(buf));
}

/**
 * Send raw PCM16 mono audio to the Realtime API.
 * If input is already 16 kHz s16le → send directly.
 * Otherwise we resample to 16 kHz s16le via ffmpeg.
 */
export function sendRealtimeAudio(data: ArrayBuffer, inputSampleRate = 16000) {
  if (isAgentSpeaking()) return;

  if (inputSampleRate === 16000) {
    const buf = Buffer.from(data);
    send16k(buf);
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
      send16k(piece);
      buffer = buffer.slice(MAX_CHUNK_SIZE);
    }
  });
  output.on("end", () => {
    if (buffer.length > 0) {
      send16k(buffer);
    }
    //scheduleCommit();
  });
}

// --- Kick off via text ------------------------------------------------------

export async function sendUserText(text: string) {
  if (!text) return;
  await wsSession.sendMessage(text);
}
