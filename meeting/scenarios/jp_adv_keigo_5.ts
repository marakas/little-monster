// scenarios/jp_adv_keigo_5.ts
import type { ScenarioPrompts, Phase } from "./types";

const explain = `
We will practice keigo commonly used in emails and formal documents.
Emphasize fixed expressions that sound natural in writing.
`.trim();

export default {
  key: "jp-adv:keigo-5",
  title: "Advanced Japanese: Email & Written Keigo",
  base: `
You are a supportive business-Japanese coach. The learner is intermediate+ and
wants practical keigo for real emails. Keep explanations short and actionable.
`.trim(),
  sticky: `
RULES:
- Keep answers ≤2 sentences; prioritize example-first teaching.
- Always show Japanese (kana/kanji) + a compact romaji + plain-English gloss.
- Correct gently: show improved version once, ask them to repeat.
- Stay on topic: written/opening/closing lines and fixed phrases.
`.trim(),
  stage: {
    intro: `
PHASE: Intro
Say once: "Let’s learn 4 email lines: opening, subject framing, attachment note, and closing."
Wait for engagement.
`.trim(),
    whiteboard_gate: `
PHASE: Teach (Keigo lines)
${explain}
Give each line; have the learner rewrite their last email using these forms.
`.trim(),
    interview: `
PHASE: Practice / Role-play
Ask them to draft a 2–3 line email using the phrases. Improve once, then repeat.
`.trim(),
  },
  greetingLine: `Email keigo time: openings, attachments, and crisp closings.`,
  overlays: {
    helloOverlay:
      "✉️ Email keigo: fixed phrases that sound natural in writing.",
    inactivityNudge: (phase: Phase) => {
      if (phase === "intro") return "Say 'OK' to see the first email line.";
      if (phase === "whiteboard_gate")
        return "Rewrite one of your real emails with this line.";
      return "Compose 2–3 lines using today’s phrases, then read them aloud.";
    },
  },

  objectives: [
    "Open and close emails politely",
    "Reference subjects and attachments correctly",
    "Keep written tone formal without sounding stiff",
  ],

  phrases: [
    {
      jp: "平素より大変お世話になっております。",
      romaji: "Heiso yori taihen o-sewa ni natte orimasu.",
      gloss: "Thank you for your continued support.",
      note: "Formal email opening; humble ‘おります’.",
    },
    {
      jp: "件名：〜の件につきまして",
      romaji: "Kemmei: ~ no ken ni tsukimashite.",
      gloss: "Subject: Regarding ~.",
      note: "‘につきまして’ is a formal ‘about/regarding’.",
    },
    {
      jp: "添付資料をご査収ください。",
      romaji: "Tenpu shiryō o go-sashū kudasai.",
      gloss: "Please confirm receipt/review of the attached documents.",
      note: "Set phrase for attachments; very formal.",
    },
    {
      jp: "取り急ぎご連絡申し上げます。",
      romaji: "Toriisogi go-renraku mōshiagemasu.",
      gloss: "Just a quick note to inform you.",
      note: "Useful when sending brief updates.",
    },
  ],

  roleplays: [
    {
      scene: "Email: sending a proposal",
      yourGoal: "Open politely, reference the proposal, mention attachment",
      partnerRole: "Client",
      prompt:
        "Write a 2–3 line email delivering a proposal PDF with a polite opening and attachment note.",
      successHint:
        "Start 平素より大変お世話になっております; add 添付資料をご査収ください。",
    },
    {
      scene: "Email: quick update",
      yourGoal: "Send a short status note",
      partnerRole: "Partner company",
      prompt:
        "Draft a brief email with a ‘quick update’ vibe using one of the fixed phrases.",
      successHint:
        "Use 取り急ぎご連絡申し上げます followed by one sentence of status.",
    },
  ],
} satisfies ScenarioPrompts;
