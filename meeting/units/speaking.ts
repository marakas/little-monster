// units/speaking.ts
import type { IUnitRunner } from "./base.ts";
import type { UnitContext, UnitRunOptions } from "./base.ts";
import type { LessonUnit } from "../lessons/types.ts";
import { setOverlay, setPhase } from "../realtimeClient.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";

const STEP_MS = 60_000;

export const SpeakingRunner: IUnitRunner = {
  type: "speaking",
  async run(
    ctx: UnitContext,
    unit: LessonUnit,
    opts: UnitRunOptions
  ): Promise<void> {
    const start = Date.now();
    const until = start + opts.maxDurationMs;

    setPhase("speaking" as any);
    if (unit.intro_text)
      setOverlay(`🗣️ Speaking\n\n${unit.intro_text}`, 120_000);

    if (opts.useRealtime) await openRealtimeSession();

    const items = unit.items ?? [];
    let i = 0;
    let nextAt = Date.now() + 1000;

    while (Date.now() < until && (!opts.signal || !opts.signal.aborted)) {
      if (Date.now() >= nextAt) {
        const it = items[i];
        if (it) {
          const ex = it.example_jp ? `\n例: ${it.example_jp}` : "";
          setOverlay(
            `【フレーズ】${it.jp} — ${it.en}${ex}\n→ まねして言ってみましょう。`,
            90_000
          );
          i = (i + 1) % items.length;
        } else {
          setOverlay(
            "フレーズの準備がありません。自由会話にしましょう。",
            60_000
          );
        }
        nextAt = Date.now() + STEP_MS;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (opts.useRealtime) await closeRealtimeSession();
  },
};
