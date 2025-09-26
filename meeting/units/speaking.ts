// units/speaking.ts
import type { IUnitRunner } from "./base.ts";
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

const LISTEN_MS = 7000;
const GAP_MS = 800;

export const SpeakingRunner: IUnitRunner = {
  type: "speaking",
  async run(ctx, unit, opts) {
    const until = Date.now() + opts.maxDurationMs;

    const base = buildUnitInstructions(ctx.lesson, unit);
    await openRealtimeSession(base);
    setRealtimeArmed(false); // guided, no bot replies

    await speakOnceAndWait(
      "Speaking practice. I will name a phrase in Japanese with a quick English gloss, then please say it."
    );
    await drainTtsPlayback(200);

    const items = unit.items ?? [];
    let i = 0;

    while (Date.now() < until && !opts.signal?.aborted) {
      const it = items[i];
      if (!it) {
        await speakOnceAndWait("No phrases provided for this section.");
        break;
      }

      await speakOnceAndWait(
        `"${it.jp}" means "${it.en}". Please say: "${it.jp}".`
      );
      await drainTtsPlayback(150);
      clearInputBuffer();
      await waitForUserSpeech({ timeoutMs: LISTEN_MS }); // listen only
      await drainTtsPlayback(150);

      // small pacing gap
      const target = Date.now() + GAP_MS;
      while (Date.now() < target) {
        if (opts.signal?.aborted) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      i = (i + 1) % Math.max(1, items.length);
    }

    await closeRealtimeSession();
  },
};
