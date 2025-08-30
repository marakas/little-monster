// control/control.worker.ts
import { parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import OpenAI from "openai";
import type {
  ControlEvent,
  ControlAction,
  RubricReport,
} from "./control.schema.ts";

if (!parentPort)
  throw new Error("control.worker must be started as a worker thread");

// ---------- paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RUBRIC_PATH = resolve(__dirname, "rubric.instagram.json");

// ---------- minimal state ----------
let tickCount = 0;
let transcriptLines = 0;
let transcriptChars = 0;

type VisionState = "none" | "blank" | "has_content" | "unknown";
let lastVisionState: VisionState | null = null;
let lastVisionComponents = 0;
let lastVisionSummary: string | null = null;

type Phase = "intro" | "whiteboard_gate" | "interview";
let currentPhase: Phase = "intro";
let lastPhaseEmitAt = 0;

// ---------- inactivity watchdog ----------
const INACTIVITY_WARN_MS = Number(
  process.env.INACTIVITY_WARN_MS ?? 5 * 60 * 1000
); // 5m
const INACTIVITY_ESC_MS = Number(
  process.env.INACTIVITY_ESC_MS ?? 8 * 60 * 1000
); // 8m
let lastActivityAt = Date.now(); // updated on transcript/vision
let inactivityStage: 0 | 5 | 8 = 0; // 0 = fresh, 5 = warned, 8 = escalated

// ---------- gating (whiteboard -> interview) ----------
const GOOD_STATES = new Set<VisionState>(["blank", "has_content"]);
const GATE_WINDOW_MS = 15_000;
const GATE_MIN_SEP_MS = 5_000;
const REEMIT_SUPPRESS_MS = 30_000;
let goodBoardSamples: number[] = [];
let lastRubric: RubricReport | null = null;

function pruneOld(now = Date.now()) {
  goodBoardSamples = goodBoardSamples.filter((t) => now - t <= GATE_WINDOW_MS);
}
function noteGoodBoard(ts = Date.now()) {
  goodBoardSamples.push(ts);
  pruneOld(ts);
}
function maybeAdvanceToInterview(now = Date.now()) {
  if (currentPhase === "interview") return;
  pruneOld(now);
  if (goodBoardSamples.length < 2) return;
  const first = goodBoardSamples[0];
  const last = goodBoardSamples[goodBoardSamples.length - 1];
  if (last - first < GATE_MIN_SEP_MS) return;
  if (now - lastPhaseEmitAt < REEMIT_SUPPRESS_MS) return;

  currentPhase = "interview";
  lastPhaseEmitAt = now;
  parentPort!.postMessage({
    type: "SET_PHASE",
    phase: "interview",
    reason: "Whiteboard stabilized as blank/has_content (twice, spaced).",
  });

  // NEW: make the interviewer lead with a clear plan
  parentPort!.postMessage({
    type: "SET_OVERLAY",
    text: [
      "Agenda: constraints → data model → media pipeline → feed → caching/scale → observability/safety.",
      "I will lead and timebox each part. Start by confirming baseline assumptions, then give a concise data model.",
    ].join(" "),
    ttlMs: 90_000,
  });

  console.log(
    `[control] PHASE → interview (samples=${
      goodBoardSamples.length
    }, sep=${Math.round((last - first) / 1000)}s)`
  );
  goodBoardSamples = [];
}

// ---------- transcript window (for rubric) ----------
type Line = { ts: number; text: string };
const transcriptBuf: Line[] = [];
const TRANSCRIPT_WINDOW_MS = 15 * 60 * 1000; // last 15 minutes

function pushTranscript(ts: number, text: string) {
  transcriptBuf.push({ ts, text });
  const now = Date.now();
  while (
    transcriptBuf.length &&
    now - transcriptBuf[0].ts > TRANSCRIPT_WINDOW_MS
  ) {
    transcriptBuf.shift();
  }
}

function currentTranscriptWindow(): string {
  return transcriptBuf.map((l) => l.text).join("\n");
}

// ---------- rubric assessment cadence ----------
const ASSESS_MIN_MS = 60_000;
const ASSESS_MAX_MS = 90_000;
let nextAssessAt = 0;

function scheduleNextAssessment() {
  const jitter =
    ASSESS_MIN_MS + Math.floor(Math.random() * (ASSESS_MAX_MS - ASSESS_MIN_MS));
  nextAssessAt = Date.now() + jitter;
}

// ---------- overlay rate-limit ----------
let lastOverlayKey: string | null = null;
let lastOverlayAt = 0;
const OVERLAY_SUPPRESS_MS = 30_000;

function maybeOverlay(text: string, key: string, ttlMs = 120_000) {
  const now = Date.now();
  // hard rate-limit to avoid back-to-back overlays regardless of key
  if (now - lastOverlayAt < OVERLAY_SUPPRESS_MS) return;

  const k = key.trim().toLowerCase();
  if (lastOverlayKey === k && now - lastOverlayAt < OVERLAY_SUPPRESS_MS) return;

  lastOverlayKey = k;
  lastOverlayAt = now;

  parentPort!.postMessage({
    type: "SET_OVERLAY",
    text,
    ttlMs,
  });
}

function maybeOverlayFromGap(gap: string | undefined, ttlMs = 120_000) {
  if (!gap) return;
  if (currentPhase !== "interview") return; // only nudge during interview
  maybeOverlay(`Next: ${gap}. Keep it to 2 sentences.`, `gap:${gap}`, ttlMs);
}

// ---------- OpenAI client ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// cache rubric file
let rubricJson: any | null = null;
async function getRubric() {
  if (!rubricJson) {
    rubricJson = JSON.parse(await readFile(RUBRIC_PATH, "utf8"));
  }
  return rubricJson;
}

// map raw LLM JSON to our RubricReport (best-effort)
function toRubricReport(obj: any): RubricReport {
  return {
    scenario: obj.scenario || "Instagram",
    overall: Number(obj.overall ?? 0),
    scores: Array.isArray(obj.scores)
      ? obj.scores.map((s: any) => ({
          id: String(s.id ?? s.label ?? "unknown"),
          label: String(s.label ?? s.id ?? "unknown"),
          score: Number(s.score ?? 0),
          justification: String(s.justification ?? s.comment ?? ""),
        }))
      : [],
    top_gaps: Array.isArray(obj.top_gaps) ? obj.top_gaps.map(String) : [],
    suggested_next_question: obj.suggested_next_question
      ? String(obj.suggested_next_question)
      : undefined,
    summary: obj.summary ? String(obj.summary) : undefined,
    updated_at: Date.now(),
  };
}

async function runRubricAssessment(): Promise<void> {
  // require some signal; skip if totally cold
  if (transcriptChars < 60) return;

  const rubric = await getRubric();
  const transcript = currentTranscriptWindow();
  const vision = {
    state: lastVisionState ?? "unknown",
    components: lastVisionComponents,
    summary: lastVisionSummary ?? "",
  };

  const system =
    "You are scoring a live system-design interview strictly by the provided rubric. " +
    "Return STRICT JSON only (no prose). Justify each score briefly.";

  const user = `RUBRIC_JSON:
${JSON.stringify(rubric, null, 2)}

TRANSCRIPT_WINDOW (latest-first ok):
${transcript}

VISION_SUMMARY:
${JSON.stringify(vision)}

Produce a JSON object with:
{
  "scenario": string,
  "overall": number, // 0..100 weighted
  "scores": [
    { "id": string, "label": string, "score": 0|1|2|3|4|5, "justification": string }
  ],
  "top_gaps": [string, ...],                // 2–5 short bullets, highest priority first
  "suggested_next_question": string,        // one concise interviewer question
  "summary": string                         // 150–200 words max
}`;

  let jsonText = "{}";
  try {
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    // easiest: use output_text; we asked for strict JSON
    jsonText = resp.output_text ?? "{}";
    const parsed = JSON.parse(jsonText);
    const report = toRubricReport(parsed);
    lastRubric = report;
    parentPort!.postMessage({ type: "RUBRIC_UPDATE", report } as ControlAction);
    // Emit a compact overlay using the top gap (if any)
    maybeOverlayFromGap(report.top_gaps?.[0]);
  } catch (e: any) {
    console.warn(
      "[control] rubric assessment failed:",
      e?.message || e,
      "\nraw:",
      jsonText.slice(0, 300)
    );
  } finally {
    scheduleNextAssessment();
  }
}

async function emitFinalReport(reason?: string) {
  try {
    // If we never ran one or it’s very old, try one last quick pass.
    const FRESH_MS = 90_000;
    const needFresh =
      !lastRubric || Date.now() - (lastRubric.updated_at || 0) > FRESH_MS;

    if (needFresh && transcriptChars >= 60) {
      // run a synchronous final pass (don’t reschedule)
      await runRubricAssessment();
    }

    // fall back to a minimal stub if still missing
    const report: RubricReport = lastRubric ?? {
      scenario: "Instagram",
      overall: 0,
      scores: [],
      top_gaps: [],
      summary: "No rubric available (insufficient activity).",
      updated_at: Date.now(),
      suggested_next_question: undefined,
    };

    parentPort!.postMessage({ type: "END_REPORT", report });
    console.log(
      `[control] END_REPORT sent${reason ? ` (reason=${reason})` : ""}`
    );
  } catch (e: any) {
    console.warn("[control] emitFinalReport failed:", e?.message || e);
  }
}

function buildInactivityNudge(): string {
  // If we aren't in interview yet, guide them to share a board
  if (currentPhase !== "interview") {
    return "Please share your screen and open a whiteboard (Miro/Excalidraw/Jamboard/Figma) so we can start sketching.";
  }

  // Prefer the top gap from the latest rubric if available
  const gap = lastRubric?.top_gaps?.[0];
  if (gap) {
    return `Let's tackle this next: ${gap}.`;
  }

  // If vision says no/unknown board, steer to draw
  if (lastVisionState === "none" || lastVisionState === "unknown") {
    return "Let's bring up a whiteboard and sketch the high-level services and data flows.";
  }

  // Safe default concrete prompt
  return "Let's walk the media pipeline: upload → scan → transcode → store → CDN.";
}

// ---------- hello overlay ----------
parentPort.postMessage({
  type: "SET_OVERLAY",
  text: "👋 Control Worker online. Overlays are live.",
  ttlMs: 30_000,
});

// ---------- loop ----------
parentPort.on("message", (ev: ControlEvent) => {
  switch (ev.type) {
    case "HELLO": {
      tickCount = 0;
      transcriptLines = 0;
      transcriptChars = 0;
      lastActivityAt = Date.now();
      inactivityStage = 0;
      lastVisionState = null;
      lastVisionComponents = 0;
      lastVisionSummary = null;
      currentPhase = "intro";
      lastPhaseEmitAt = 0;
      goodBoardSamples = [];
      parentPort!.postMessage({
        type: "SET_OVERLAY",
        text: "Start with the ground rules, invite questions, then wait for whiteboard.",
        ttlMs: 45_000,
      });
      scheduleNextAssessment();
      console.log(`[control] HELLO meetingId=${ev.meetingId ?? "<none>"}`);
      break;
    }

    case "TICK": {
      tickCount += 1;

      // existing checks
      maybeAdvanceToInterview();
      if (Date.now() >= nextAssessAt) void runRubricAssessment();

      // ---- inactivity watchdog ----
      const now = Date.now();
      const idleFor = now - lastActivityAt;

      if (idleFor >= INACTIVITY_ESC_MS && inactivityStage < 8) {
        const text = buildInactivityNudge();
        maybeOverlay(text, `inactivity:8:${currentPhase}`, 180_000); // longer TTL on escalation
        inactivityStage = 8;
        console.log(
          `[control] INACTIVITY escalation overlay after ${Math.round(
            idleFor / 1000
          )}s`
        );
      } else if (idleFor >= INACTIVITY_WARN_MS && inactivityStage < 5) {
        const text = buildInactivityNudge();
        maybeOverlay(text, `inactivity:5:${currentPhase}`, 120_000);
        inactivityStage = 5;
        console.log(
          `[control] INACTIVITY warning overlay after ${Math.round(
            idleFor / 1000
          )}s`
        );
      }

      if (tickCount % 12 === 0) {
        console.log(
          `[control] TICK x${tickCount} | vision=${
            lastVisionState ?? "n/a"
          } comps=${lastVisionComponents} | lines=${transcriptLines} chars=${transcriptChars}`
        );
      }
      break;
    }

    case "TRANSCRIPT_APPENDED": {
      transcriptLines += 1;
      transcriptChars += ev.text.length;
      pushTranscript(ev.ts || Date.now(), ev.text);

      const preview = ev.text.replace(/\s+/g, " ").slice(0, 120);
      console.log(
        `[control] TRANSCRIPT line#${transcriptLines} (+${
          ev.text.length
        } chars): "${preview}${ev.text.length > 120 ? "…" : ""}"`
      );
      lastActivityAt = Date.now();
      inactivityStage = 0;

      // NEW: lightweight "ack" detector to leave intro
      if (currentPhase === "intro") {
        const ack =
          /\b(yes|ok|okay|sure|sounds good|understand|got it|ready)\b/i;
        const askedAQuestion =
          /(\?|could you|can you|what about|how do|how would)/i;

        // Heuristics: either explicit ack OR user has engaged with ≥1 lines and not silence
        if (
          ack.test(ev.text) ||
          transcriptLines >= 2 ||
          askedAQuestion.test(ev.text)
        ) {
          currentPhase = "whiteboard_gate";
          lastPhaseEmitAt = Date.now();
          parentPort!.postMessage({
            type: "SET_PHASE",
            phase: "whiteboard_gate",
            reason: "Intro acknowledged; prompting to share whiteboard.",
          });
          maybeOverlay(
            "Please share your screen and open a whiteboard (Miro/Excalidraw/Jamboard/Figma).",
            "wb:prompt",
            120_000
          );
        }
      }

      break;
    }

    case "VISION_UPDATE": {
      lastVisionState = ev.state;
      lastVisionComponents = ev.componentsCount ?? 0;
      lastVisionSummary = ev.summary ?? null;

      if (GOOD_STATES.has(ev.state)) {
        noteGoodBoard(ev.ts ?? Date.now());
        // Existing: will call maybeAdvanceToInterview() → SET_PHASE("interview")
        maybeAdvanceToInterview();
      } else {
        pruneOld();
        // NEW: nudge only during whiteboard_gate
        if (currentPhase === "whiteboard_gate") {
          maybeOverlay(
            "I’m not seeing a whiteboard yet—please share your screen with Miro/Excalidraw/Jamboard/Figma.",
            "wb:nudge",
            60_000
          );
        }
      }

      const sum = (ev.summary ?? "").replace(/\s+/g, " ").slice(0, 160);
      console.log(
        `[control] VISION state=${
          ev.state
        } comps=${lastVisionComponents} summary="${sum}${
          (ev.summary ?? "").length > 160 ? "…" : ""
        }"`
      );
      lastActivityAt = Date.now();
      inactivityStage = 0;
      break;
    }

    case "SESSION_END": {
      void emitFinalReport(ev.reason);
      break;
    }

    default:
      break;
  }
});
