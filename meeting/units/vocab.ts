// units/vocab.ts
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import {
  updateInstructions,
  speakOnceAndWait,
  setRealtimeArmed,
} from "../realtimeClient.ts";
import { buildUnitInstructions } from "../lessons/prompt.ts";

export const VocabRunner: IUnitRunner = {
  type: "vocab",
  async run(ctx, unit, opts) {
    const until = Date.now() + opts.maxDurationMs;

    if (opts.useRealtime) {
      const base = buildUnitInstructions(ctx.lesson, unit);
      await openRealtimeSession(base);
      await updateInstructions(base);
      setRealtimeArmed(false); // ✅ stay scripted
    }

    await speakOnceAndWait(
      unit.intro_text
        ? `Vocabulary section. ${unit.intro_text}`
        : "Vocabulary section. We’ll practice polite keigo words for customer calls."
    );

    const items = unit.items ?? [];
    let i = 0;
    const STEP_MS = 60000;

    while (Date.now() < until && (!opts.signal || !opts.signal.aborted)) {
      const it = items[i];
      if (!it) {
        await speakOnceAndWait(
          "No vocabulary items were provided for this lesson."
        );
        break;
      }

      await speakOnceAndWait(
        `${it.jp}. ${it.en}.${
          it.example_jp ? ` Example: ${it.example_jp}` : ""
        }`
      );

      i = (i + 1) % items.length;

      // pacing gap between items
      const pauseUntil = Date.now() + STEP_MS;
      while (Date.now() < pauseUntil) {
        await new Promise((r) => setTimeout(r, 200));
        if (opts.signal?.aborted) break;
      }
    }

    if (opts.useRealtime) await closeRealtimeSession();
  },
};
