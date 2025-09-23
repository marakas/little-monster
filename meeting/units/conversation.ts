// units/conversation.ts
import type { IUnitRunner } from "./base.ts";
import type { UnitContext, UnitRunOptions } from "./base.ts";
import type { LessonUnit } from "../lessons/types.ts";
import { setOverlay, setPhase } from "../realtimeClient.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";

const STEP_MS = 75_000;

export const ConversationRunner: IUnitRunner = {
  type: "conversation",
  async run(
    ctx: UnitContext,
    unit: LessonUnit,
    opts: UnitRunOptions
  ): Promise<void> {
    const start = Date.now();
    const until = start + opts.maxDurationMs;

    setPhase("conversation" as any);
    if (unit.intro_text)
      setOverlay(`📞 Conversation\n\n${unit.intro_text}`, 120_000);

    if (opts.useRealtime) await openRealtimeSession();

    const turns = (unit.turns ?? []).sort(
      (a, b) => a.order_index - b.order_index
    );
    let idx = 0;
    let nextAt = Date.now() + 1000;

    while (Date.now() < until && (!opts.signal || !opts.signal.aborted)) {
      if (Date.now() >= nextAt) {
        const t = turns[idx];
        if (t) {
          const who = t.speaker === "bot" ? "🟢 Bot" : "🟣 You";
          setOverlay(`${who}: ${t.jp}\n${t.en}`, 90_000);
          idx = (idx + 1) % Math.max(turns.length, 1);
        } else {
          setOverlay(
            "会話スクリプトがありません。自由会話にしましょう。",
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
