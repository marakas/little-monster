// engine/lessonOrchestrator.ts
import type { PageLike } from "../types/page-like.ts";
import type { LessonResponse, LessonUnit } from "../lessons/types.ts";
import type { UnitContext } from "../units/base.ts";
import { getRunner } from "../units/index.ts";
import { runKickoff } from "./kickoff.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import { updateInstructions, speakOnce } from "../realtimeClient.ts";

type OrchestratorOptions = {
  meetingId: string;
  introMs?: number; // (optional; no longer used for sleeping)
  vocabMs?: number;
  speakingMs?: number;
  conversationMs?: number;
  wrapMs?: number;
  signal?: AbortSignal;
  introOnly?: boolean;
};

export async function runLessonOrchestrated(
  _page: PageLike,
  lesson: LessonResponse,
  opts: OrchestratorOptions
) {
  const ctx: UnitContext = {
    page: _page as any,
    lesson,
    meetingId: opts.meetingId,
  };

  // Build durations once
  const durations = {
    vocabMs: opts.vocabMs ?? 5 * 60_000,
    speakingMs: opts.speakingMs ?? 5 * 60_000,
    conversationMs: opts.conversationMs ?? 5 * 60_000,
  };

  // 🔹 Kickoff (event-driven: speak → short “ok?” gate → proceed)
  await runKickoff(lesson, durations, { ackTimeoutMs: 6000 });

  await new Promise((r) => setTimeout(r, 250));

  if (opts.introOnly || process.env.INTRO_ONLY === "1") {
    console.log("[orchestrator] introOnly=true → skipping units and wrap");
    return;
  }

  // 🔹 Units
  const plan: Array<{
    unit?: LessonUnit;
    kind: "vocab" | "speaking" | "conversation";
    ms: number;
    useRealtime: boolean;
  }> = [
    {
      unit: lesson.units.find((u) => u.type === "vocab"),
      kind: "vocab",
      ms: durations.vocabMs,
      useRealtime: true,
    },
    {
      unit: lesson.units.find((u) => u.type === "speaking"),
      kind: "speaking",
      ms: durations.speakingMs,
      useRealtime: true,
    },
    {
      unit: lesson.units.find((u) => u.type === "conversation"),
      kind: "conversation",
      ms: durations.conversationMs,
      useRealtime: true,
    },
  ];

  for (const step of plan) {
    if (opts.signal?.aborted) break;
    const runner = step.unit && getRunner(step.kind);
    if (!runner || !step.unit) continue;

    await runner.run(ctx, step.unit, {
      maxDurationMs: step.ms,
      useRealtime: step.useRealtime,
      signal: opts.signal,
    });
    await new Promise((r) => setTimeout(r, 250));
  }

  // 🔹 Wrap (short, scripted)
  await openRealtimeSession("Keep it short and polite.");
  await updateInstructions(
    "You are a polite Japanese instructor. Keep it short."
  );
  speakOnce(
    "Great work today. This concludes our mini lesson. See you next time."
  );
  await new Promise((r) => setTimeout(r, opts.wrapMs ?? 20_000));
  await closeRealtimeSession();
}
