// realtimeClient.ts  (REPLACE FILE)
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { PassThrough } from "stream";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

ffmpeg.setFfmpegPath(ffmpegPath!);

const REALTIME_MODEL =
  process.env.REALTIME_MODEL ?? "gpt-4o-mini-realtime-preview";
const TRANSCRIBE_MODEL =
  process.env.TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
const DEFAULT_VOICE = process.env.INTERVIEW_VOICE ?? "alloy";

let wsSession: RealtimeSession | null = null;
let agent: RealtimeAgent | null = null;

let agentSpeaking = false;
let realtimeArmed = false;

// ---------- Public status ----------
export function isAgentSpeaking() {
  return agentSpeaking;
}
export function isRealtimeArmed() {
  return realtimeArmed;
}

// ---------- Event fans ----------
type AnyEvent = any;
const eventListeners = new Set<(ev: AnyEvent) => void>();
export function onRealtimeEvent(cb: (ev: AnyEvent) => void) {
  eventListeners.add(cb);
}

// Audio out (tts from model)
let playCb: ((buffer: ArrayBuffer) => void) | undefined;
export function onRealtimeAudio(cb: (buffer: ArrayBuffer) => void) {
  playCb = cb;
}

// ---------- Init / Close ----------
export async function initRealtime(
  apiKey: string,
  opts?: { model?: string; voice?: string; baseInstructions?: string }
) {
  // fresh agent/session per call
  agent = new RealtimeAgent({
    name: "Assistant",
    instructions: (opts?.baseInstructions ?? "").trim(),
    tools: [],
  });

  wsSession = new RealtimeSession(agent, {
    transport: "websocket",
    model: opts?.model ?? REALTIME_MODEL,
    config: {
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      inputAudioTranscription: {
        model: TRANSCRIBE_MODEL,
        language: "en",
      },
      turnDetection: {
        type: "semantic_vad",
        eagerness: "high",
        createResponse: false, // disarmed until caller arms
        interruptResponse: true,
      },
    },
  });

  bindSessionEvents(wsSession);

  wsSession.on("audio", (event) => playCb?.(event.data));

  await wsSession.connect({ apiKey });

  // Set initial voice + instructions (if given)
  await updateInstructions(
    opts?.baseInstructions ?? "",
    opts?.voice ?? DEFAULT_VOICE
  );

  // Always start disarmed; unit code decides when to arm
  setRealtimeArmed(false);
}

export async function closeRealtime() {
  try {
    setRealtimeArmed(false);
  } catch {}
  try {
    wsSession?.transport.sendEvent({ type: "response.cancel" });
  } catch {}
  try {
    wsSession?.transport.sendEvent({ type: "input_audio_buffer.clear" });
  } catch {}

  try {
    const s: any = wsSession;
    if (s?.close) s.close();
    else if (s?.disconnect) await s.disconnect();
  } catch (e) {
    console.warn("[RTC] closeRealtime failed:", (e as any)?.message || e);
  }

  // reset flags
  agentSpeaking = false;
  waitingForTranscript = false;
  resetCommitBudget();
  if (speakingTimer) clearTimeout(speakingTimer);
  speakingTimer = null;
  if (transcriptFallbackTimer) clearTimeout(transcriptFallbackTimer);
  transcriptFallbackTimer = null;

  wsSession = null;
  agent = null;
}

// ---------- Session updates ----------
export async function updateInstructions(text: string, voice?: string) {
  if (!wsSession) return;
  wsSession.transport.sendEvent({
    type: "session.update",
    session: {
      ...(text ? { instructions: text } : {}),
      ...(voice ? { voice } : {}),
    },
  });
}

export function setRealtimeArmed(on: boolean) {
  if (!wsSession) return;
  realtimeArmed = on;
  wsSession.transport.sendEvent({
    type: "session.update",
    session: {
      turn_detection: {
        type: "semantic_vad",
        eagerness: "high",
        create_response: on,
        interrupt_response: true,
      },
    },
  });
  console.log(on ? "[RTC] ARMED" : "[RTC] DISARMED");
}

// request a one-shot model turn (tts+text)
export function speakOnce(instructions?: string) {
  if (!wsSession) return;
  wsSession.transport.sendEvent({
    type: "response.create",
    response: {
      modalities: ["audio", "text"],
      ...(instructions ? { instructions } : {}),
    },
  });
}

// ---------- Input audio (mic → model) ----------
const INPUT_RATE = 16000;
const MIN_COMMIT_MS = 220;
const SILENCE_MS = 650;

let bytesSinceCommit = 0;
let lastAppendAt = 0;
let voicedSinceLastCommit = false;
let waitingForTranscript = false;
let transcriptFallbackTimer: NodeJS.Timeout | null = null;

function canCommit() {
  const msBuffered = (bytesSinceCommit / 2 / INPUT_RATE) * 1000;
  const quietFor = Date.now() - lastAppendAt;
  return (
    voicedSinceLastCommit &&
    msBuffered >= MIN_COMMIT_MS &&
    quietFor >= SILENCE_MS
  );
}
function resetCommitBudget() {
  bytesSinceCommit = 0;
  voicedSinceLastCommit = false;
}

export function clearInputBuffer() {
  wsSession?.transport.sendEvent({ type: "input_audio_buffer.clear" });
}

export function commitNow() {
  if (!wsSession) return;
  if (!realtimeArmed) return;
  if (isAgentSpeaking()) return;
  if (!canCommit()) return;

  wsSession.transport.sendEvent({ type: "input_audio_buffer.commit" });
  waitingForTranscript = true;

  if (transcriptFallbackTimer) clearTimeout(transcriptFallbackTimer);
  transcriptFallbackTimer = setTimeout(() => {
    waitingForTranscript = false;
  }, 1800);

  resetCommitBudget();
}

// 16k passthrough (already s16le@16k mono)
function send16k(buf: Buffer) {
  if (!wsSession) return;
  wsSession.sendAudio(bufferToArrayBuffer(buf));

  bytesSinceCommit += buf.length;
  lastAppendAt = Date.now();

  try {
    const v = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    let sum = 0,
      n = 0;
    for (let i = 0; i < v.length; i += 16) {
      const s = v[i];
      sum += s * s;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    if (rms > 220) voicedSinceLastCommit = true;
  } catch {}
}

export function sendRealtimeAudio(data: ArrayBuffer, inputSampleRate = 16000) {
  if (isAgentSpeaking()) return;
  if (!wsSession) return;

  if (inputSampleRate === 16000) {
    send16k(Buffer.from(data));
    return;
  }

  const MAX_CHUNK_SIZE = 4096;
  const input = new PassThrough();
  const output = new PassThrough();
  input.end(Buffer.from(data));

  ffmpeg(input)
    .inputOptions(["-f", "s16le", "-ar", String(inputSampleRate), "-ac", "1"])
    .audioFrequency(16000)
    .audioChannels(1)
    .audioCodec("pcm_s16le")
    .format("s16le")
    .on("error", (err) => console.error("[RTC] Resample error:", err.message))
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
    if (buffer.length > 0) send16k(buffer);
  });
}

// ---------- internals ----------
let speakingTimer: NodeJS.Timeout | null = null;

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

function bindSessionEvents(s: RealtimeSession) {
  (s.on as any)("event", (ev: AnyEvent) => {
    // model speech lifecycle
    if (ev?.type === "response.created") {
      agentSpeaking = true;
    }
    if (
      ev?.type === "response.completed" ||
      ev?.type === "response.failed" ||
      ev?.type === "response.canceled"
    ) {
      agentSpeaking = false;
    }
    eventListeners.forEach((cb) => {
      try {
        cb(ev);
      } catch {}
    });
  });

  s.on("error", (e) =>
    console.error("[RTC] session error:", JSON.stringify(e, null, 2))
  );
}
