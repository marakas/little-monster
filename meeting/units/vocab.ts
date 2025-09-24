import type { IUnitRunner, UnitContext, UnitRunOptions } from "./base.ts";
import type { LessonUnit } from "../lessons/types.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import { updateInstructions, speakOnce } from "../realtimeClient.ts";

const STEP_MS = 60_000;

export const VocabRunner: IUnitRunner = {
  type: "vocab",
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
        "You are a polite Japanese instructor teaching keigo vocabulary for customer calls. " +
          "Keep your speech short (under 10 seconds). For each item, say the Japanese term, then a brief English gloss, then a short example in Japanese."
      );
    }

    if (unit.intro_text) {
      speakOnce(`Lesson section: vocabulary. ${unit.intro_text}`);
    } else {
      speakOnce("We will practice polite keigo vocabulary for customer calls.");
    }

    const items = unit.items ?? [];
    let i = 0;
    let nextAt = Date.now() + 1500;

    while (Date.now() < until && (!opts.signal || !opts.signal.aborted)) {
      if (Date.now() >= nextAt) {
        const it = items[i];
        if (it) {
          const ex = it.example_jp ? ` Example: ${it.example_jp}` : "";
          speakOnce(`${it.jp}. ${it.en}.${ex}`);
          i = (i + 1) % items.length;
        } else {
          speakOnce("No vocabulary items provided. Let's do free practice.");
        }
        nextAt = Date.now() + STEP_MS;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (opts.useRealtime) await closeRealtimeSession();
  },
};
