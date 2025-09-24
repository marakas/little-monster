import type { IUnitRunner, UnitContext, UnitRunOptions } from "./base.ts";
import type { LessonUnit } from "../lessons/types.ts";
import {
  openRealtimeSession,
  closeRealtimeSession,
} from "../sessions/realtimeSession.ts";
import { updateInstructions, speakOnce } from "../realtimeClient.ts";

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

    if (opts.useRealtime) {
      await openRealtimeSession();
      await updateInstructions(
        "You are a polite Japanese instructor. Prompt the learner to repeat short keigo phone phrases. " +
          "Speak one phrase at a time, then pause to listen. Keep each prompt under 10 seconds."
      );
    }

    speakOnce(
      unit.intro_text ||
        "Repeat after me. I will give you short polite phone phrases."
    );

    const items = unit.items ?? [];
    let i = 0;
    let nextAt = Date.now() + 1500;

    while (Date.now() < until && (!opts.signal || !opts.signal.aborted)) {
      if (Date.now() >= nextAt) {
        const it = items[i];
        if (it) {
          speakOnce(`${it.jp}. ${it.en}. Please repeat.`);
          i = (i + 1) % items.length;
        } else {
          speakOnce(
            "No prepared phrases. Please say a polite phone greeting in Japanese."
          );
        }
        nextAt = Date.now() + STEP_MS;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (opts.useRealtime) await closeRealtimeSession();
  },
};
