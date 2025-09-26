// engine/kickoff.ts
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import {
  speakOnce,
  updateInstructions,
  speakOnceAndWait,
  drainTtsPlayback,
} from "../realtimeClient.ts";
import type { LessonResponse } from "../lessons/types.ts";

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

function mins(ms: number) {
  return Math.round(ms / 60000);
}

function cleanNotes(notes?: string) {
  if (!notes) return "";
  let n = notes.trim();
  // strip common “requesty” prefixes
  n = n
    .replace(/^i (?:would like to|want to|want a|would like a)\s*/i, "")
    .replace(/^(?:please|make it|let's do)\s*/i, "")
    .replace(/\bclass\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // lowercase first if it’s sentence-ish
  if (/^[A-Z]/.test(n) && !/[.!?]$/.test(n))
    n = n[0].toLowerCase() + n.slice(1);
  return n;
}

function prettyFocus(lesson: LessonResponse) {
  const raw = (lesson.lesson.focus || "").trim().toLowerCase();
  // map a few known internal tags → friendly label
  const map: Record<string, string> = {
    intro: "polite phone introductions (keigo)",
    keigo: "polite Japanese (keigo)",
    calls: "keigo for customer calls",
  };
  if (map[raw]) return map[raw];

  // fallbacks: turn "phone_support" → "Phone Support"
  if (raw) return titleCase(raw.replace(/[_-]+/g, " "));

  // last resort: cleaned notes if available
  const n = cleanNotes(lesson.lesson.notes);
  return n || "today’s objectives";
}

function buildKickoffMonologue(
  lesson: LessonResponse,
  durs: { vocabMs: number; speakingMs: number; conversationMs: number }
) {
  const focus = prettyFocus(lesson);
  return [
    `Hello and welcome to today's lesson.`,
    `Our focus is ${focus}.`,
    `We'll spend about ${mins(durs.vocabMs)} minutes on vocabulary,`,
    `${mins(durs.speakingMs)} on speaking practice,`,
    `and ${mins(durs.conversationMs)} on a short conversation.`,
    `Let's begin shortly.`,
  ].join(" ");
}

export async function runKickoff(
  lesson: LessonResponse,
  durs: { vocabMs: number; speakingMs: number; conversationMs: number },
  opts?: { sleepMs?: number }
) {
  // Keep DISARMED: scripted monologue only.
  await openRealtimeSession(
    [
      `ROLE: Polite Japanese instructor for telephone keigo.`,
      `SYSTEM: This kickoff is a scripted monologue.`,
      `- Do NOT ask for confirmation or questions.`,
      `- Do NOT acknowledge plans with phrases like "okay" or "sounds good".`,
      `- Do NOT wait for a user reply.`,
      `- Speak only when a response is created.`,
      `Keep each utterance under 8 seconds.`,
    ].join("\n")
  );
  // re-apply to be safe (no harm if called twice)
  await updateInstructions(
    `SYSTEM: Kickoff is scripted. Do not ask questions. Do not reply to prior instructions.`
  );

  const line = buildKickoffMonologue(lesson, durs);

  // One-shot, deterministic line — wait for the model to finish speaking
  await speakOnceAndWait(`Speak exactly this line and nothing else: "${line}"`);

  // Let the audio queue flush to Meet, then close (still DISARMED)
  await drainTtsPlayback(350);
  await closeRealtimeSession();
}
