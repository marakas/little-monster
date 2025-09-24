// engine/kickoff.ts
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import { speakOnce, updateInstructions } from "../realtimeClient.ts";
import type { LessonResponse } from "../lessons/types.ts";

function mins(ms: number) {
  return Math.round(ms / 60000);
}

function buildKickoffMonologue(
  lesson: LessonResponse,
  durs: { vocabMs: number; speakingMs: number; conversationMs: number }
) {
  const focus = lesson.lesson.focus || "today's focus";
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

  // One-shot, deterministic line
  speakOnce(`Speak exactly this line and nothing else: "${line}"`);

  // Give TTS time to play, then close session (still DISARMED)
  await new Promise((r) => setTimeout(r, opts?.sleepMs ?? 6000));
  await closeRealtimeSession();
}
