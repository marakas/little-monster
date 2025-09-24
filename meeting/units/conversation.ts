import type { IUnitRunner, UnitContext, UnitRunOptions } from "./base.ts";
import type { LessonUnit } from "../lessons/types.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import { updateInstructions, speakOnce } from "../realtimeClient.ts";

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

    if (opts.useRealtime) {
      await openRealtimeSession();
      await updateInstructions(
        "You are the 'bot' side of a short Japanese phone call with a customer. " +
          "Follow the script turns. Keep responses brief and polite. If the learner speaks, respond naturally."
      );
    }

    speakOnce(
      unit.intro_text ||
        "Let's simulate a short customer phone call in Japanese."
    );

    const turns = (unit.turns ?? []).sort(
      (a, b) => a.order_index - b.order_index
    );
    let idx = 0;
    let nextAt = Date.now() + 1500;

    while (Date.now() < until && (!opts.signal || !opts.signal.aborted)) {
      if (Date.now() >= nextAt) {
        const t = turns[idx];
        if (t) {
          if (t.speaker === "bot") {
            speakOnce(t.jp);
          } else {
            // user turn: gently prompt them to speak that line
            speakOnce(`Your turn: ${t.jp}`);
          }
          idx = (idx + 1) % Math.max(turns.length, 1);
        } else {
          speakOnce("Let's continue the conversation naturally.");
        }
        nextAt = Date.now() + STEP_MS;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (opts.useRealtime) await closeRealtimeSession();
  },
};
