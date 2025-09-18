// scenarios/jp_adv_keigo_2.ts
import type { ScenarioPrompts, Phase } from "./types";

const explain = `
We will practice scheduling and availability in keigo.
Focus on softening requests and offering options without pressure.
`.trim();

export default {
  key: "jp-adv:keigo-2",
  title: "Advanced Japanese: Keigo for Scheduling",
  base: `
You are a supportive business-Japanese coach. The learner is intermediate+ and
wants practical keigo for real meetings/calls. Keep explanations short and actionable.
`.trim(),
  sticky: `
RULES:
- Keep answers ≤2 sentences; prioritize example-first teaching.
- Always show Japanese (kana/kanji) + a compact romaji + plain-English gloss.
- Correct gently: show improved version once, ask them to repeat.
- Stay on topic: keigo for scheduling and availability.
`.trim(),
  stage: {
    intro: `
PHASE: Intro
Say once: "We’ll practice polite scheduling lines, then role-play rescheduling."
Wait for engagement.
`.trim(),
    whiteboard_gate: `
PHASE: Teach (Keigo lines)
${explain}
Present the lines one-by-one, then invite the learner to adapt with their dates/times.
`.trim(),
    interview: `
PHASE: Practice / Role-play
Choose a role-play. If they answer in plain form, upgrade to keigo and ask them to repeat.
`.trim(),
  },
  greetingLine: `Great, let’s practice polite scheduling so you can book meetings smoothly.`,
  overlays: {
    helloOverlay:
      "🗓️ Advanced JP (Keigo): scheduling lines, then a quick rescheduling role-play.",
    inactivityNudge: (phase: Phase) => {
      if (phase === "intro")
        return "Ready? Say 'OK' to start the scheduling practice.";
      if (phase === "whiteboard_gate")
        return "Your turn: repeat with an actual date/time that suits you.";
      return "Use keigo to propose or adjust a time in 1–2 sentences.";
    },
  },

  objectives: [
    "Offer and request times using soft keigo",
    "Reschedule without causing pressure",
    "Confirm next steps politely",
  ],

  phrases: [
    {
      jp: "ご都合のよろしい日時をお知らせいただけますか。",
      romaji: "Go-tsugō no yoroshii nichiji o oshirase itadakemasu ka.",
      gloss: "Could you let me know a convenient date and time?",
      note: "Soft request; ‘いただけますか’ keeps it gentle.",
    },
    {
      jp: "本日中に日程案をお送りいたします。",
      romaji: "Honjitsu-chū ni nittei-an o o-okuri itashimasu.",
      gloss: "I’ll send schedule options today.",
      note: "Kenjōgo ‘いたします’ + honorific ‘お送り’.",
    },
    {
      jp: "日程を再調整させていただけますでしょうか。",
      romaji: "Nittei o saichōsei sasete itadakemasu deshō ka.",
      gloss: "May we reschedule the meeting?",
      note: "‘〜させていただく’ shows deference when asking to change plans.",
    },
    {
      jp: "来週以降でご都合はいかがでしょうか。",
      romaji: "Raishū ikō de go-tsugō wa ikaga deshō ka.",
      gloss: "Would next week or later work for you?",
      note: "Open-ended option, lowers pressure.",
    },
  ],

  roleplays: [
    {
      scene: "Email: proposing times",
      yourGoal: "Offer two time slots and ask for their preference",
      partnerRole: "Client",
      prompt:
        "Politely propose two options for a 30-minute call and ask which they prefer.",
      successHint:
        "Use ご都合のよろしい日時…; then 本日中に日程案をお送りいたします or offer two concrete slots.",
    },
    {
      scene: "Phone: rescheduling",
      yourGoal: "Request to move tomorrow’s meeting due to a conflict",
      partnerRole: "Colleague (senior)",
      prompt:
        "Apologize and ask to reschedule tomorrow’s 10:00 meeting to later in the week.",
      successHint:
        "Begin with 申し訳ございません; then 日程を再調整させていただけますでしょうか。",
    },
  ],
} satisfies ScenarioPrompts;
