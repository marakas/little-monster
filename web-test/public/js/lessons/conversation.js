// public/js/lessons/conversation.js
export function makeRunConversation({ realtime }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return async function runConversation(lesson, unit, until) {
    realtime.updateInstructions(
      [
        "ROLE: Instructor for Japanese telephone keigo.",
        "FLOW: Scripted role-play. Read only lines where speaker=bot (in JP).",
        "After each bot line, wait briefly for the user.",
        "If silence: one short English hint, then repeat once.",
      ].join("\n")
    );
    const turns = unit.turns || [];
    if (!turns.length) {
      await realtime.speakOnceAndWait("No conversation provided.");
      return;
    }
    let idx = 0;
    while (Date.now() < until) {
      const t = turns[idx];
      if (!t) break;
      if (String(t.speaker).toLowerCase() === "bot") {
        await realtime.speakOnceAndWait(String(t.jp));
        const heard = await realtime.waitForUserSpeech({ timeoutMs: 5000 });
        if (!heard) {
          await realtime.speakOnceAndWait(
            "Hint: respond briefly in Japanese. Repeating."
          );
          await realtime.speakOnceAndWait(String(t.jp));
          await realtime.waitForUserSpeech({ timeoutMs: 4000 });
        }
      } else {
        await realtime.speakOnceAndWait(`Your turn. Please say: "${t.jp}"`);
        await realtime.waitForUserSpeech({ timeoutMs: 6000 });
      }
      idx = (idx + 1) % turns.length;
      await sleep(0); // preserves pacing
    }
  };
}
