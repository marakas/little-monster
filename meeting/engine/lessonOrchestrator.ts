// engine/lessonOrchestrator.ts
import type { PageLike } from "../types/page-like.ts";

import type { LessonResponse, LessonUnit } from "../lessons/types.ts";
import { setOverlay, setPhase } from "../realtimeClient.ts";
import type { UnitContext } from "../units/base.ts";
import { getRunner } from "../units/index.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";

export type OrchestratorOptions = {
  meetingId: string;
  introMs?: number;
  vocabMs?: number;
  speakingMs?: number;
  conversationMs?: number;
  wrapMs?: number;
  signal?: AbortSignal;
};

export async function runLessonOrchestrated(
  page: PageLike,
  lesson: LessonResponse,
  opts: OrchestratorOptions
) {
  const ctx: UnitContext = { page, lesson, meetingId: opts.meetingId };

  // Intro block (separate session so you can switch model or disable later)
  setPhase("intro" as any);
  const title = `🧩 Lesson: ${lesson.lesson.level} / ${lesson.lesson.focus}`;
  const note = lesson.lesson.notes ? `\nNotes: ${lesson.lesson.notes}` : "";
  setOverlay(
    `${title}${note}\n\n今日は①語彙 ②スピーキング ③会話 の順で練習します。`,
    60_000
  );

  await openRealtimeSession();
  await sleep(opts.introMs ?? 60_000, opts.signal);
  await closeRealtimeSession();

  // Units (per-unit lifecycle)
  const plan: Array<{
    unit?: LessonUnit;
    kind: "vocab" | "speaking" | "conversation";
    ms: number;
    useRealtime: boolean;
  }> = [
    {
      unit: pick("vocab"),
      kind: "vocab",
      ms: opts.vocabMs ?? 5 * 60_000,
      useRealtime: true,
    },
    {
      unit: pick("speaking"),
      kind: "speaking",
      ms: opts.speakingMs ?? 5 * 60_000,
      useRealtime: true,
    },
    {
      unit: pick("conversation"),
      kind: "conversation",
      ms: opts.conversationMs ?? 5 * 60_000,
      useRealtime: true,
    },
  ];

  for (const step of plan) {
    if (opts.signal?.aborted) break;
    if (!step.unit) {
      setOverlay(
        `"${step.kind}" セクションはありません。次へ進みます。`,
        30_000
      );
      await sleep(1_500, opts.signal);
      continue;
    }

    const runner = getRunner(step.kind);
    if (!runner) {
      setOverlay(
        `"${step.kind}" のランナーが見つかりません。スキップします。`,
        30_000
      );
      continue;
    }

    await runner.run(ctx, step.unit, {
      maxDurationMs: step.ms,
      useRealtime: step.useRealtime,
      signal: opts.signal,
    });
  }

  // Wrap (no session, short)
  setPhase("wrap" as any);
  setOverlay("本日はここまでです。お疲れさまでした！", 30_000);
}

function pick(
  kind: "vocab" | "speaking" | "conversation"
): LessonUnit | undefined {
  // (simple: first of each kind; expand later if multiple)
  return thisLesson()?.units.find((u) => u.type === kind);

  function thisLesson(): LessonResponse | undefined {
    // Closure replacement: not ideal—so do this:
    return (runLessonOrchestrated as any).__lastLesson as
      | LessonResponse
      | undefined;
  }
}

// Tiny helper so pick() can see the lesson (keeps API simple)
(runLessonOrchestrated as any).__lastLesson = null;

export function bindLessonForPick(l: LessonResponse) {
  (runLessonOrchestrated as any).__lastLesson = l;
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (!ms) return;
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => resolve(), ms);
    if (signal)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
  });
}
