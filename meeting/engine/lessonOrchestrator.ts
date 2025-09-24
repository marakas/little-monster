// engine/lessonOrchestrator.ts  (UPDATE)
import type { PageLike } from "../types/page-like.ts"; // or remove if unused
import type { LessonResponse, LessonUnit } from "../lessons/types.ts";
import type { UnitContext } from "../units/base.ts";
import { setCurrentLesson } from "../lessons/context.ts";
import { getRunner } from "../units/index.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import { updateInstructions, speakOnce } from "../realtimeClient.ts";

export type OrchestratorOptions = {
  meetingId: string;
  introMs?: number;
  vocabMs?: number;
  speakingMs?: number;
  conversationMs?: number;
  wrapMs?: number;
  signal?: AbortSignal;
};

// Back-compat for meetbot.ts
export function bindLessonForPick(lesson: LessonResponse) {
  setCurrentLesson(lesson);
}

export async function runLessonOrchestrated(
  _page: PageLike, // not used anymore; keep for future UI hooks if you like
  lesson: LessonResponse,
  opts: OrchestratorOptions
) {
  const ctx: UnitContext = {
    page: _page as any,
    lesson,
    meetingId: opts.meetingId,
  };

  // Spoken intro (its own short session, then closed)
  await openRealtimeSession();
  await updateInstructions(
    "You are a polite Japanese instructor. Keep prompts short (<=10 seconds). " +
      "You are guiding a 3-part mini lesson: vocabulary, speaking, and conversation."
  );
  speakOnce(
    `Welcome. Today's focus is ${lesson.lesson.focus}. We will study vocabulary, then speaking, then a short conversation.`
  );
  await sleep(opts.introMs ?? 45_000, opts.signal);
  await closeRealtimeSession();

  // Units
  const plan: Array<{
    unit?: LessonUnit;
    kind: "vocab" | "speaking" | "conversation";
    ms: number;
    useRealtime: boolean;
  }> = [
    {
      unit: lesson.units.find((u) => u.type === "vocab"),
      kind: "vocab",
      ms: opts.vocabMs ?? 5 * 60_000,
      useRealtime: true,
    },
    {
      unit: lesson.units.find((u) => u.type === "speaking"),
      kind: "speaking",
      ms: opts.speakingMs ?? 5 * 60_000,
      useRealtime: true,
    },
    {
      unit: lesson.units.find((u) => u.type === "conversation"),
      kind: "conversation",
      ms: opts.conversationMs ?? 5 * 60_000,
      useRealtime: true,
    },
  ];

  for (const step of plan) {
    if (opts.signal?.aborted) break;
    const runner = step.unit && getRunner(step.kind);
    if (!runner || !step.unit) {
      // silent skip (no overlay)
      continue;
    }

    await runner.run(ctx, step.unit, {
      maxDurationMs: step.ms,
      useRealtime: step.useRealtime,
      signal: opts.signal,
    });
  }

  // Wrap (short, spoken)
  await openRealtimeSession();
  await updateInstructions(
    "You are a polite Japanese instructor. Keep it short."
  );
  speakOnce(
    "Great work today. This concludes our mini lesson. See you next time."
  );
  await sleep(opts.wrapMs ?? 20_000, opts.signal);
  await closeRealtimeSession();
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (!ms) return;
  await new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}
