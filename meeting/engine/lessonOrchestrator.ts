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
  skipIntro?: boolean;
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

  const SKIP_INTRO = opts.skipIntro ?? process.env.SKIP_INTRO === "1";
  const INTRO_ONLY = opts.introOnly || process.env.INTRO_ONLY === "1";

  if (SKIP_INTRO && INTRO_ONLY) {
    console.warn(
      "[orchestrator] Both SKIP_INTRO and INTRO_ONLY set; honoring SKIP_INTRO (run units, no intro)."
    );
  }

  // Kickoff (only if not skipping)
  if (!SKIP_INTRO) {
    // NOTE: if your runKickoff signature no longer takes opts, remove the extra arg:
    await runKickoff(lesson, durations);
    await new Promise((r) => setTimeout(r, 250)); // micro-gap
    if (INTRO_ONLY) {
      console.log("[orchestrator] introOnly=true → skipping units and wrap");
      return;
    }
  } else {
    console.log("[orchestrator] SKIP_INTRO=true → jumping straight to units");
  }

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
    await new Promise((r) => setTimeout(r, 250)); // micro-gap between units
  }

  // Wrap
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
