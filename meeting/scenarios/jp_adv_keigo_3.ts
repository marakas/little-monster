// scenarios/jp_adv_keigo_3.ts
import type { ScenarioPrompts, Phase } from "./types";

const explain = `
We will practice apologies and escalations in keigo.
Be concise, own the issue, promise a concrete next step.
`.trim();

export default {
  key: "jp-adv:keigo-3",
  title: "Advanced Japanese: Apologies & Escalations",
  base: `
You are a supportive business-Japanese coach. The learner is intermediate+ and
wants practical keigo for real meetings/calls. Keep explanations short and actionable.
`.trim(),
  sticky: `
RULES:
- Keep answers ≤2 sentences; prioritize example-first teaching.
- Always show Japanese (kana/kanji) + a compact romaji + plain-English gloss.
- Correct gently: show improved version once, ask them to repeat.
- Stay on topic: apologies, status, and escalation paths.
`.trim(),
  stage: {
    intro: `
PHASE: Intro
Say once: "Let’s practice sincere apologies and clear next steps."
Wait for engagement.
`.trim(),
    whiteboard_gate: `
PHASE: Teach (Keigo lines)
${explain}
Present each line with a quick usage cue; have the learner mirror with their scenario.
`.trim(),
    interview: `
PHASE: Practice / Role-play
Prompt a short complaint scenario; coach them to respond in keigo with action.
`.trim(),
  },
  greetingLine: `We’ll keep apologies crisp and professional, then practice escalation wording.`,
  overlays: {
    helloOverlay:
      "⚠️ Keigo for issues: apologize, give next step, escalate if needed.",
    inactivityNudge: (phase: Phase) => {
      if (phase === "intro") return "Say 'OK' to try the first apology line.";
      if (phase === "whiteboard_gate")
        return "Now adapt it: what exact action will you take next?";
      return "Respond with apology + concrete next step in ≤2 sentences.";
    },
  },

  objectives: [
    "Deliver a sincere apology in business keigo",
    "Promise a specific action and timeline",
    "Mention escalation without sounding threatening",
  ],

  phrases: [
    {
      jp: "ご不便をおかけして申し訳ございません。",
      romaji: "Go-fuben o o-kake shite mōshiwake gozaimasen.",
      gloss: "We apologize for the inconvenience.",
      note: "Stronger than すみません; standard for incidents.",
    },
    {
      jp: "直ちに確認し、折り返しご連絡いたします。",
      romaji: "Tadachi ni kakunin shi, orikaeshi go-renraku itashimasu.",
      gloss: "We will check immediately and get back to you.",
      note: "Kenjōgo ‘いたします’; shows urgency + plan.",
    },
    {
      jp: "早急に対応いたします。",
      romaji: "Sokyū ni taiō itashimasu.",
      gloss: "We’ll handle this promptly.",
      note: "Concise commitment line.",
    },
    {
      jp: "必要に応じて、担当部署へエスカレーションいたします。",
      romaji: "Hitsuyō ni ōjite, tantō-busho e esukarēshon itashimasu.",
      gloss: "We’ll escalate to the responsible team if needed.",
      note: "Neutral escalation phrasing.",
    },
  ],

  roleplays: [
    {
      scene: "Client complaint: delayed response",
      yourGoal: "Apologize and promise a timeline",
      partnerRole: "Client",
      prompt:
        "They say your reply was late. Apologize and commit to a specific next update.",
      successHint:
        "Start ご不便をおかけして申し訳ございません; then 直ちに確認し、◯時までに折り返しご連絡いたします。",
    },
    {
      scene: "Production bug",
      yourGoal: "Acknowledge, promise fix path, mention escalation",
      partnerRole: "Internal stakeholder (senior)",
      prompt:
        "Own the issue and describe the immediate action and escalation path.",
      successHint:
        "Use 早急に対応いたします; add 必要に応じて…エスカレーションいたします。",
    },
  ],
} satisfies ScenarioPrompts;
