//realtimeClient.ts
import * as fs from "node:fs";
import * as path from "node:path";

import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { PassThrough } from "stream";
import { getScenario } from "./scenarios/index.ts";
import type { Phase } from "./scenarios/types.ts";

const DEFAULT_LANGUAGE = process.env.INTERVIEW_LANG ?? "en-US";
const DEFAULT_VOICE = process.env.INTERVIEW_VOICE ?? "alloy"; // any valid realtime voice

const PROMPT_DEBUG = process.env.PROMPT_DEBUG === "1";
const PROMPT_DEBUG_PREVIEW = Number(process.env.PROMPT_DEBUG_PREVIEW || 320);

let PROMPT_LOG_DIR: string | null = null;
export function setPromptLogDir(dir: string | null) {
  PROMPT_LOG_DIR = dir;
}

let agentSpeaking = false;
let _interviewStarted = false;
let realtimeArmed = false;

export function isRealtimeArmed() {
  return realtimeArmed;
}

// -----------------------------
// Phase plumbing (inside agent)
// -----------------------------
type WhiteboardState = "none" | "blank" | "has_content" | "unknown";
type VisionReply = { state: WhiteboardState; summary?: string; app?: string };

ffmpeg.setFfmpegPath(ffmpegPath!);

// allow external listeners to observe raw session events if needed
export function onRealtimeEvent(cb: (ev: any) => void) {
  (wsSession.on as any)("event", cb);
}

//export const PHASES = ["intro", "whiteboard_gate", "interview"] as const;
//export type Phase = (typeof PHASES)[number];

export function setRealtimeArmed(on: boolean) {
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
  console.log(
    on
      ? "[RTC][prompt] Realtime ARMED (create_response=true)"
      : "[RTC][prompt] Realtime DISARMED (create_response=false)"
  );
}

// Helper to flush any queued input frames on the server
export function clearInputBuffer() {
  wsSession.transport.sendEvent({ type: "input_audio_buffer.clear" });
}

export type LiveAssessmentReply = {
  ok: boolean;
  live?: {
    scores?: Array<{ category: string; score: number; comment: string }>;
    top_gaps?: string[];
    suggested_next_question?: string;
  };
  diagram_state?: "none" | "blank" | "has_content" | "unknown";
  diagram_components_count?: number;
  error?: string;
};

let assessmentProvider: (() => Promise<LiveAssessmentReply>) | null = null;
export function registerAssessmentProvider(
  fn: () => Promise<LiveAssessmentReply>
) {
  assessmentProvider = fn;
}

let currentPhase: Phase = "intro";

// Compose per-phase instructions from the active scenario.
function makeInstructions(phase: Phase) {
  const s = getScenario();
  const languageLine =
    `LANGUAGE: English (${DEFAULT_LANGUAGE}). ` +
    `Always speak and write ONLY in English unless showing the Japanese line.`;
  return [languageLine, s.base, s.sticky, s.stage[phase]].join("\n\n").trim();
}

// ---------------
// Realtime agent
// ---------------
const agent = new RealtimeAgent({
  name: "Assistant",
  instructions: makeInstructions("intro"),
  tools: [],
});

export const wsSession = new RealtimeSession(agent, {
  transport: "websocket",
  //model: "gpt-4o-realtime-preview-2025-06-03",
  model: "gpt-realtime",
  config: {
    inputAudioFormat: "pcm16",
    outputAudioFormat: "pcm16",
    inputAudioTranscription: {
      model: "gpt-4o-transcribe",
      language: "en",
    },
    turnDetection: {
      type: "semantic_vad",
      eagerness: "high",
      createResponse: false, // start DISARMED
      interruptResponse: true,
    },
  },
});

// wire responseMgr to session lifecycle + allow others to listen
(wsSession.on as any)("event", (ev: any) => {
  // When a model response starts/ends
  if (ev.type === "response.created") {
    console.log(`[RTC][response.created] id=${ev.response?.id || "?"}`);
    // Guard: cancel any response before we've armed
    if (!realtimeArmed && ev.response?.id) {
      console.log("[RTC][prompt] Cancelling early response (not yet armed)");
      wsSession.transport.sendEvent({
        type: "response.cancel",
        response_id: ev.response.id,
      });
      return;
    }
    agentSpeaking = true;
  }

  if (
    ev.type === "response.completed" ||
    ev.type === "response.failed" ||
    ev.type === "response.canceled"
  ) {
    console.log(`[RTC][response.ended] type=${ev.type}`);
    agentSpeaking = false;
  }

  if (
    ev.type === "error" &&
    ev?.error?.error?.code === "conversation_already_has_active_response"
  ) {
    console.warn("[RTC][auto] server says active response already in progress");
  }
});

wsSession.on("error", (e) =>
  console.error("[RTC]Realtime session error:", JSON.stringify(e, null, 2))
);

// -----------------------------
// Audio piping (agent -> user)
// -----------------------------
let playCb: ((buffer: ArrayBuffer) => void) | undefined;
export function onRealtimeAudio(cb: (buffer: ArrayBuffer) => void) {
  playCb = cb;
}
let audioListenerBound = false;

function chunkHasVoice(ab: ArrayBuffer): boolean {
  const v = new Int16Array(ab);
  if (v.length === 0) return false;
  let sum = 0,
    n = 0;
  for (let i = 0; i < v.length; i += 16) {
    sum += v[i] * v[i];
    n++;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return rms > 200;
}

let speakingTimer: NodeJS.Timeout | null = null;
export function isAgentSpeaking() {
  return agentSpeaking;
}
function markAgentSpeaking() {
  agentSpeaking = true;
  if (speakingTimer) clearTimeout(speakingTimer);
  speakingTimer = setTimeout(() => {
    agentSpeaking = false;
  }, 1200);
}

export async function initRealtime(apiKey: string) {
  if (!audioListenerBound) {
    wsSession.on("audio", (event) => {
      playCb?.(event.data);
    });
    audioListenerBound = true;
  }
  await wsSession.connect({ apiKey });

  // Start DISARMED → no auto replies before we join the call
  setRealtimeArmed(false);

  // Ensure current phase instructions are set (intro by default)
  wsSession.transport.sendEvent({
    type: "session.update",
    session: {
      instructions: makeInstructions(currentPhase),
      voice: DEFAULT_VOICE,
    },
  });
}

export async function startPhasedInterview() {
  if (_interviewStarted) return;
  _interviewStarted = true;

  const s = getScenario();
  speakOnce(
    `You are the instructor/interviewer. Speak exactly this line and nothing else: "${s.greetingLine}"`
  );
}

/* ---------- input audio commit helpers ---------- */
const INPUT_RATE = 16000;
const MIN_COMMIT_MS = 220;
const SILENCE_MS = 650;

// Keep bytesSinceCommit as server-truth of what we've appended (16k s16le)
let bytesSinceCommit = 0;
let lastAppendAt = 0; // last time we appended audio to server
let voicedSinceLastCommit = false; // whether we appended voiced frames
let waitingForTranscript = false; // set true when we commit
let transcriptFallbackTimer: NodeJS.Timeout | null = null;

// maintain legacy constant for compatibility (unused by logic directly)
const MIN_COMMIT_BYTES = Math.floor((INPUT_RATE * 2 * MIN_COMMIT_MS) / 1000);

// Backwards-compatible helpers (now advisory)
function canCommit() {
  const msBuffered =
    (bytesSinceCommit / 2 /* bytes→samples */ / INPUT_RATE) * 1000;
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

export function commitNow() {
  if (!realtimeArmed) return;
  if (isAgentSpeaking()) return;
  if (!canCommit()) return;
  console.log("[RTC]commitNow");
  wsSession.transport.sendEvent({ type: "input_audio_buffer.commit" });

  // Wait for ASR to finish before creating the response
  waitingForTranscript = true;
  if (transcriptFallbackTimer) clearTimeout(transcriptFallbackTimer);
  transcriptFallbackTimer = setTimeout(() => {
    if (waitingForTranscript) {
      waitingForTranscript = false;
    }
  }, 1800);

  resetCommitBudget();
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

// send16k now *also* updates server-truth counters & light VAD
function send16k(buf: Buffer) {
  wsSession.sendAudio(bufferToArrayBuffer(buf));

  // update counters based on what we really appended
  bytesSinceCommit += buf.length;
  lastAppendAt = Date.now();

  // simple RMS to mark that this chunk had voice-like energy
  try {
    const v = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    let sum = 0,
      n = 0;
    for (let i = 0; i < v.length; i += 16) {
      const s = v[i];
      sum += s * s;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n)); // 0..32767
    if (rms > 220) voicedSinceLastCommit = true; // tune 200–280 if needed
  } catch {
    /* noop */
  }
}

export function sendRealtimeAudio(data: ArrayBuffer, inputSampleRate = 16000) {
  if (isAgentSpeaking()) return;
  if (inputSampleRate === 16000) {
    const buf = Buffer.from(data);
    send16k(buf);
    return;
  }
  const MAX_CHUNK_SIZE = 4096; // ~128 ms at 16 kHz, smoother VAD + lower latency;
  const input = new PassThrough();
  const output = new PassThrough();
  input.end(Buffer.from(data));

  ffmpeg(input)
    .inputOptions(["-f", "s16le", "-ar", String(inputSampleRate), "-ac", "1"])
    .audioFrequency(16000)
    .audioChannels(1)
    .audioCodec("pcm_s16le")
    .format("s16le")
    .on("error", (err) => console.error("[RTC]Resample error:", err.message))
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

// ----- Conversation steering surface (session.update only) -----
let overlayText: string | null = null;
let overlayClearTimer: NodeJS.Timeout | null = null;

function applyInstructions() {
  const base = makeInstructions(currentPhase);
  const overlay = overlayText
    ? `\n\n# Supervisor hint (temporary)\n${overlayText}`
    : "";
  const finalInstructions = (base + overlay).trim();

  // DEBUG preview
  if (PROMPT_DEBUG) {
    const preview = finalInstructions
      .replace(/\s+/g, " ")
      .slice(0, PROMPT_DEBUG_PREVIEW);
    console.log(
      `[RTC][prompt][${currentPhase}] len=${
        finalInstructions.length
      } preview="${preview}${
        finalInstructions.length > PROMPT_DEBUG_PREVIEW ? "…" : ""
      }"`
    );
    if (overlayText) {
      const oPrev = overlayText
        .replace(/\s+/g, " ")
        .slice(0, PROMPT_DEBUG_PREVIEW);
      console.log(
        `[RTC][prompt][overlay] ttl=${
          overlayClearTimer ? "active" : "n/a"
        } text="${oPrev}${
          overlayText.length > PROMPT_DEBUG_PREVIEW ? "…" : ""
        }"`
      );
    }
  }

  // Persist full instructions for traceability
  if (PROMPT_LOG_DIR) {
    try {
      const t = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(
        PROMPT_LOG_DIR,
        `instructions_${t}_${currentPhase}.md`
      );
      fs.writeFileSync(file, finalInstructions, "utf8");
    } catch (e) {
      if (PROMPT_DEBUG)
        console.warn(
          "[RTC][prompt] failed to write instructions file:",
          (e as any)?.message || e
        );
    }
  }

  wsSession.transport.sendEvent({
    type: "session.update",
    session: { instructions: finalInstructions },
  });
}

export function setPhase(next: Phase) {
  if (currentPhase === next) return;
  if (PROMPT_DEBUG)
    console.log(`[RTC][prompt] SET_PHASE ${currentPhase} → ${next}`);
  currentPhase = next;
  overlayText = null;
  if (overlayClearTimer) {
    clearTimeout(overlayClearTimer);
    overlayClearTimer = null;
  }
  applyInstructions();
}

export function setOverlay(text: string, ttlMs = 120_000) {
  overlayText = (text || "").trim().slice(0, 400);
  if (PROMPT_DEBUG) {
    const prev = overlayText
      .replace(/\s+/g, " ")
      .slice(0, PROMPT_DEBUG_PREVIEW);
    console.log(
      `[RTC][prompt] SET_OVERLAY ttlMs=${ttlMs} text="${prev}${
        overlayText.length > PROMPT_DEBUG_PREVIEW ? "…" : ""
      }"`
    );
  }
  applyInstructions();
  if (overlayClearTimer) clearTimeout(overlayClearTimer);
  overlayClearTimer = setTimeout(() => {
    overlayText = null;
    if (PROMPT_DEBUG)
      console.log(
        "[RTC][prompt] OVERLAY expired; re-applying base instructions"
      );
    applyInstructions();
  }, Math.max(10_000, ttlMs));
}

// Helper to trigger a one-shot model turn with optional per-turn instructions.
export function speakOnce(instructions?: string) {
  wsSession.transport.sendEvent({
    type: "response.create",
    response: {
      modalities: ["audio", "text"],
      ...(instructions ? { instructions } : {}),
    },
  });
}
