// public/js/lessons/vocab.js
export function makeRunVocab({ realtime, log }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return async function runVocab(lesson, unit, until) {
    realtime.updateInstructions(
      [
        "ROLE: Instructor for Japanese telephone keigo.",
        "INSTRUCTOR_LANGUAGE: English only for explanations and prompts.",
        "TARGET_LANGUAGE: Use Japanese only for the target term/phrase itself and provided JP example lines.",
        "CONSTRAINTS:",
        "- Keep each instructor turn under 8 seconds.",
        "- Do not invent new content; use only the unit data.",
        "- Do not move to the next section on your own.",
      ].join("\n")
    );
    const items = unit.items || [];
    let i = 0;
    while (Date.now() < until) {
      const it = items[i];
      if (!it) {
        await realtime.speakOnceAndWait(
          "No vocabulary provided for this section."
        );
        break;
      }
      await realtime.speakOnceAndWait(
        `Vocabulary: "${it.jp}" means "${it.en}".`
      );
      await sleep(120);
      await realtime.speakOnceAndWait(`Please repeat: "${it.jp}".`);
      const heard = await realtime.waitForUserSpeech({ timeoutMs: 6500 });
      log("[vocab] user said:", heard);
      if (it.example_jp) await realtime.speakOnceAndWait(it.example_jp);
      await sleep(200);
      i = (i + 1) % Math.max(1, items.length);
    }
  };
}
