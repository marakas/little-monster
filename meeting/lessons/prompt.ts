//lessons/prompt.ts
import type { LessonResponse, LessonUnit } from "./types.ts";

export function buildUnitInstructions(
  lesson: LessonResponse,
  unit: LessonUnit
): string {
  const hdr = [
    `ROLE: Polite Japanese instructor for telephone keigo.`,
    `LEVEL: ${lesson.lesson.level}`,
    `FOCUS: ${lesson.lesson.focus}`,
    lesson.lesson.notes ? `NOTES: ${lesson.lesson.notes}` : "",
    `CURRENT_UNIT: ${unit.type}`,
    ``,
    `CONSTRAINTS:`,
    `- Speak only within CURRENT_UNIT content.`,
    `- Keep each utterance under 8 seconds.`,
    `- Use English only for quick glosses; otherwise Japanese.`,
    `- Do not start the next section on your own.`,
  ]
    .filter(Boolean)
    .join("\n");

  if (unit.type === "vocab") {
    const items = (unit.items ?? [])
      .map(
        (i) =>
          `- ${i.jp} — ${i.en}${i.example_jp ? ` | ex: ${i.example_jp}` : ""}`
      )
      .join("\n");
    const flow = [
      `FLOW (scripted):`,
      `1) Say "Vocabulary section" in 1 sentence.`,
      `2) For each item: JP term → short EN gloss → short JP example.`,
      `3) Brief pause between items.`,
      `4) No extra drills or new topics.`,
    ].join("\n");
    return [hdr, flow, `ITEMS:\n${items}`].join("\n\n");
  }

  if (unit.type === "speaking") {
    const items = (unit.items ?? [])
      .map((i) => `- ${i.jp} — ${i.en}`)
      .join("\n");
    const flow = [
      `FLOW (interactive):`,
      `- Prompt the learner to say the target phrase.`,
      `- If close, give one short correction and a single repeat.`,
      `- Keep turns short; stay on unit items.`,
    ].join("\n");
    return [hdr, flow, `TARGETS:\n${items}`].join("\n\n");
  }

  if (unit.type === "conversation") {
    const turns = (unit.turns ?? [])
      .map((t) => `${t.speaker.toUpperCase()}: ${t.jp}`)
      .join("\n");
    const flow = [
      `FLOW (guided role-play):`,
      `- Speak only the lines where speaker=bot, in order.`,
      `- Wait for the user after each bot line.`,
      `- If silence/confusion: 1-sentence hint and repeat the same line once.`,
      `- Do not change scenes or add topics.`,
    ].join("\n");
    return [hdr, flow, `SCRIPT:\n${turns}`].join("\n\n");
  }

  return hdr;
}
