// scenarios/jp_adv_keigo_6.ts
import type { ScenarioPrompts, Phase } from "./types";

const explain = `
We will practice soft refusals, deferrals, and proposing alternatives in keigo.
Stay respectful, give a reason if possible, and offer a next step.
`.trim();

export default {
  key: "jp-adv:keigo-6",
  title: "Advanced Japanese: Soft No & Deferrals",
  base: `
You are a supportive business-Japanese coach. The learner is intermediate+ and
wants practical keigo for delicate situations. Keep explanations short and actionable.
`.trim(),
  sticky: `
RULES:
- Keep answers ≤2 sentences; prioritize example-first teaching.
- Always show Japanese (kana/kanji) + a compact romaji + plain-English gloss.
- Correct gently: show improved version once, ask them to repeat.
- Stay on topic: polite declines, deferrals, and alternatives.
`.trim(),
  stage: {
    intro: `
PHASE: Intro
Say once: "We’ll practice polite ways to decline or defer, then offer alternatives."
Wait for engagement.
`.trim(),
    whiteboard_gate: `
PHASE: Teach (Keigo lines)
${explain}
Model each line; have the learner attach a brief reason and an alternative.
`.trim(),
    interview: `
PHASE: Practice / Role-play
Give a request that you must decline or delay; coach a respectful response.
`.trim(),
  },
  greetingLine: `Tricky asks? Let’s practice polite declines and smart alternatives.`,
  overlays: {
    helloOverlay:
      "🧭 Soft no in keigo: decline, give a reason, propose next step.",
    inactivityNudge: (phase: Phase) => {
      if (phase === "intro") return "Say 'OK' to try a soft refusal line.";
      if (phase === "whiteboard_gate")
        return "Now add a reason and an alternative date/plan.";
      return "Decline or defer in ≤2 sentences using keigo.";
    },
  },

  objectives: [
    "Decline requests without damaging rapport",
    "Defer decisions while keeping momentum",
    "Propose realistic alternatives politely",
  ],

  phrases: [
    {
      jp: "大変恐れ入りますが、今回は見送らせていただきます。",
      romaji: "Taihen osore irimasu ga, konkai wa miokurasete itadakimasu.",
      gloss: "We’re very sorry, but we’ll pass this time.",
      note: "Humble ‘〜させていただく’ softens a refusal.",
    },
    {
      jp: "現時点では難しく、代替案をご提案いたします。",
      romaji: "Genjiten de wa muzukashiku, daitai-an o go-teian itashimasu.",
      gloss: "It’s difficult at this time, so we’ll propose an alternative.",
      note: "Pair with a concrete substitute.",
    },
    {
      jp: "前向きに検討いたしますが、少々お時間を頂戴できますか。",
      romaji:
        "Maemuki ni kentō itashimasu ga, shōshō o-jikan o chōdai dekimasu ka.",
      gloss: "We’ll consider it, may we have a bit more time?",
      note: "Defers without sounding negative.",
    },
    {
      jp: "社内で確認の上、改めてご連絡いたします。",
      romaji: "Shanai de kakunin no ue, aratamete go-renraku itashimasu.",
      gloss: "We’ll confirm internally and get back to you.",
      note: "Standard defer-and-follow-up line.",
    },
  ],

  roleplays: [
    {
      scene: "Budget request you cannot accept",
      yourGoal: "Decline politely and propose an alternative approach",
      partnerRole: "Vendor",
      prompt:
        "They ask for an increased budget. Decline or defer and propose a smaller pilot.",
      successHint:
        "Use 大変恐れ入りますが、今回は見送らせていただきます; then 代替案をご提案いたします。",
    },
    {
      scene: "Deadline extension",
      yourGoal: "Ask for more time without blaming others",
      partnerRole: "Client",
      prompt: "You need one extra week. Request politely and keep trust.",
      successHint:
        "Use 前向きに検討いたしますが、少々お時間を頂戴できますか; confirm next step with 社内で確認の上…。",
    },
  ],
} satisfies ScenarioPrompts;
