// units/conversation.ts
import type { IUnitRunner, UnitContext, UnitRunOptions } from "./base.ts";
import type { LessonUnit } from "../lessons/types.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import {
  updateInstructions,
  speakOnceAndWait,
  setRealtimeArmed,
  clearInputBuffer,
} from "../realtimeClient.ts";
import { buildUnitInstructions } from "../lessons/prompt.ts";

export const ConversationRunner: IUnitRunner = {
  type: "conversation",
  async run(ctx, unit, opts) {
    const until = Date.now() + opts.maxDurationMs;
    const turns = unit.turns ?? [];

    if (opts.useRealtime) {
      const base = buildUnitInstructions(ctx.lesson, unit);
      await openRealtimeSession(base);
      await updateInstructions(base);
      setRealtimeArmed(false); // start scripted
    }

    await speakOnceAndWait(
      unit.intro_text
        ? `Conversation practice. ${unit.intro_text}`
        : "Conversation practice. I’ll be the staff; you are the customer."
    );

    if (opts.useRealtime) {
      clearInputBuffer();
      setRealtimeArmed(true); // ✅ now listen and respond to the user
    }

    for (const t of turns) {
      if (Date.now() >= until || opts.signal?.aborted) break;

      if (t.speaker === "bot") {
        // Send bot line, wait until it finishes
        await speakOnceAndWait(t.jp);
      } else {
        // user turn → just wait a bit; the armed session will answer if needed
        // (or you can key off ASR events and timing)
        await new Promise((r) => setTimeout(r, 2500));
      }
    }

    if (opts.useRealtime) await closeRealtimeSession();
  },
};
