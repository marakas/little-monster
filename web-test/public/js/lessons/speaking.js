// public/js/lessons/speaking.js
export function makeRunSpeaking({ realtime, log }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return async function runSpeaking(lesson, unit, until) {
    realtime.updateInstructions(
      [
        "ROLE: Instructor for Japanese telephone keigo.",
        "INSTRUCTOR_LANGUAGE: English only; target line in Japanese.",
        "CONSTRAINTS: Keep each turn under 8s. Do not add new content.",
      ].join("\n")
    );
    await realtime.speakOnceAndWait(
      "Speaking practice. I will name a phrase in Japanese with a quick English gloss, then please say it."
    );
    await sleep(150);
    const items = unit.items || [];
    if (!items.length) {
      await realtime.speakOnceAndWait("No phrases provided for speaking.");
      return;
    }
    let i = 0;
    while (Date.now() < until) {
      const it = items[i];
      await realtime.speakOnceAndWait(
        `"${it.jp}" means "${it.en}". Please say: "${it.jp}".`
      );
      const heard = await realtime.waitForUserSpeech({ timeoutMs: 7000 });
      log("[speaking] user said:", heard);
      await sleep(350);
      i = (i + 1) % items.length;
    }
  };
}
