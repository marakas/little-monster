// units/vocab.ts
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import {
  speakOnceAndWait,
  setRealtimeArmed,
  drainTtsPlayback,
  clearInputBuffer,
  waitForUserSpeech,
} from "../realtimeClient.ts";
import { buildUnitInstructions } from "../lessons/prompt.ts";
import type { IUnitRunner } from "./base.ts";

const DRILL_LISTEN_MS = 7000; // window for the learner to repeat
const BETWEEN_STEPS_MS = 250; // tiny breathers to avoid overlap
const BETWEEN_ITEMS_MS = 1200; // pacing between items

export const VocabRunner: IUnitRunner = {
  type: "vocab",
  async run(ctx, unit, opts) {
    const until = Date.now() + opts.maxDurationMs;

    // Fresh session per unit with strict, English-only instructions
    const base = buildUnitInstructions(ctx.lesson, unit);
    await openRealtimeSession(base);
    setRealtimeArmed(false); // scripted only

    // English intro regardless of JP intro_text
    await speakOnceAndWait(
      "Vocabulary section. I will explain each word in English, have you repeat the Japanese, then give a short example."
    );
    await drainTtsPlayback(BETWEEN_STEPS_MS);

    const items = unit.items ?? [];
    let i = 0;

    while (Date.now() < until && !opts.signal?.aborted) {
      const it = items[i];
      if (!it) {
        await speakOnceAndWait(
          "No vocabulary items were provided for this lesson."
        );
        break;
      }

      // 1) English explanation (JP → EN)
      await speakOnceAndWait(`"${it.jp}" means "${it.en}".`);
      await drainTtsPlayback(BETWEEN_STEPS_MS);

      // 2) Pronunciation drill (English prompt) → listen without replying
      await speakOnceAndWait(`Please repeat: "${it.jp}".`);
      await drainTtsPlayback(180); // tiny gap
      clearInputBuffer();
      // Stay DISARMED so the model won't talk; just wait for ASR
      const heard = await waitForUserSpeech({ timeoutMs: DRILL_LISTEN_MS });
      if (!heard) {
        // one gentle nudge, still in English
        await speakOnceAndWait("Try once more, just the Japanese word.");
        await drainTtsPlayback(150);
        clearInputBuffer();
        await waitForUserSpeech({
          timeoutMs: Math.floor(DRILL_LISTEN_MS * 0.6),
        });
      }
      await drainTtsPlayback(BETWEEN_STEPS_MS);

      // 3) Context line (JP example only)
      if (it.example_jp) {
        await speakOnceAndWait(`In context: ${it.example_jp}`);
        await drainTtsPlayback(BETWEEN_STEPS_MS);
      }

      // Move to next item
      const pauseUntil = Date.now() + BETWEEN_ITEMS_MS;
      while (Date.now() < pauseUntil) {
        if (opts.signal?.aborted) break;
        await new Promise((r) => setTimeout(r, 120));
      }

      i = (i + 1) % Math.max(1, items.length);
    }

    await closeRealtimeSession();
  },
};
