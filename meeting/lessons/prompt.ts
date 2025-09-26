import type { LessonResponse, LessonUnit } from "./types.ts";

export function buildUnitInstructions(
  lesson: LessonResponse,
  unit: LessonUnit
): string {
  const hdr = [
    `ROLE: Instructor for Japanese telephone keigo.`,
    `INSTRUCTOR_LANGUAGE: English only for explanations and prompts.`,
    `TARGET_LANGUAGE: Use Japanese only for the target term/phrase itself and any provided JP example lines.`,
    `LEVEL: ${lesson.lesson.level}`,
    `FOCUS: ${lesson.lesson.focus}`,
    lesson.lesson.notes ? `NOTES: ${lesson.lesson.notes}` : "",
    `CURRENT_UNIT: ${unit.type}`,
    ``,
    `CONSTRAINTS:`,
    `- Keep each instructor turn under 8 seconds.`,
    `- Do not invent new content; use only the unit data.`,
    `- Do not move to the next section on your own.`,
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
      `FLOW (per item, strict):`,
      `1) English explain: say "${
        unit.type === "vocab" ? "Vocabulary" : "Item"
      }: <JP> means <EN>."`,
      `2) Pronunciation drill (English prompt): "Please repeat '<JP>'."`,
      `   - Listen without replying.`,
      `   - If silence: one short English nudge, then move on.`,
      `3) Context line: speak the provided JP example once.`,
      `4) Then proceed to the next item.`,
    ].join("\n");
    return [hdr, flow, `ITEMS:\n${items}`].join("\n\n");
  }

  if (unit.type === "speaking") {
    const items = (unit.items ?? [])
      .map((i) => `- ${i.jp} — ${i.en}`)
      .join("\n");
    const flow = [
      `FLOW (repeat & brief listen):`,
      `- English prompt: "Please say '<JP>' (which means '<EN>')."`,
      `- Listen without replying; if silence, one English nudge and continue.`,
    ].join("\n");
    return [hdr, flow, `TARGETS:\n${items}`].join("\n\n");
  }

  if (unit.type === "conversation") {
    const turns = (unit.turns ?? [])
      .map((t) => `${t.speaker.toUpperCase()}: ${t.jp}`)
      .join("\n");
    const flow = [
      `FLOW (scripted role-play):`,
      `- Read only the lines where speaker=bot (in JP).`,
      `- After each bot line, wait briefly for user.`,
      `- If silence: one short English hint, then repeat the same line once.`,
    ].join("\n");
    return [hdr, flow, `SCRIPT:\n${turns}`].join("\n\n");
  }

  return hdr;
}
