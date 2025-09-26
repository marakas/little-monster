// units/conversation.ts
import type { IUnitRunner } from "./base.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import {
  speakOnceAndWait,
  setRealtimeArmed,
  drainTtsPlayback,
} from "../realtimeClient.ts";
import { buildUnitInstructions } from "../lessons/prompt.ts";

const USER_WAIT_MS = 7000;

export const ConversationRunner: IUnitRunner = {
  type: "conversation",
  async run(ctx, unit, opts) {
    const until = Date.now() + opts.maxDurationMs;
    const turns = unit.turns ?? [];

    const base = buildUnitInstructions(ctx.lesson, unit);
    await openRealtimeSession(base);
    setRealtimeArmed(false); // scripted bot lines only

    await speakOnceAndWait(
      "Conversation practice. I’ll speak the staff lines in Japanese. Please reply briefly as the customer."
    );
    await drainTtsPlayback(200);

    for (const t of turns) {
      if (Date.now() >= until || opts.signal?.aborted) break;

      if (t.speaker === "bot") {
        await speakOnceAndWait(t.jp); // JP line
        await drainTtsPlayback(150);
      } else {
        // User time window (we do not speak back here)
        const waitUntil = Date.now() + USER_WAIT_MS;
        while (Date.now() < waitUntil) {
          if (opts.signal?.aborted) break;
          await new Promise((r) => setTimeout(r, 120));
        }
      }
    }

    await closeRealtimeSession();
  },
};
