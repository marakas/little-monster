// scenarios/jp_adv_keigo_4.ts
import type { ScenarioPrompts, Phase } from "./types";

const explain = `
We will practice soft requests and permissions in keigo.
Aim for consent-seeking language and clear, polite asks.
`.trim();

export default {
  key: "jp-adv:keigo-4",
  title: "Advanced Japanese: Requests & Permissions",
  base: `
You are a supportive business-Japanese coach. The learner is intermediate+ and
wants practical keigo for real meetings/calls. Keep explanations short and actionable.
`.trim(),
  sticky: `
RULES:
- Keep answers ≤2 sentences; prioritize example-first teaching.
- Always show Japanese (kana/kanji) + a compact romaji + plain-English gloss.
- Correct gently: show improved version once, ask them to repeat.
- Stay on topic: polite requests and permission-seeking.
`.trim(),
  stage: {
    intro: `
PHASE: Intro
Say once: "Let’s practice soft requests that win easy ‘yes’ responses."
Wait for engagement.
`.trim(),
    whiteboard_gate: `
PHASE: Teach (Keigo lines)
${explain}
Deliver each line and have the learner personalize the object (file, deck, access).
`.trim(),
    interview: `
PHASE: Practice / Role-play
Prompt them to ask for permission or a review; upgrade wording to keigo if needed.
`.trim(),
  },
  greetingLine: `Next, we’ll practice gentle, high-consent requests used in Japanese business.`,
  overlays: {
    helloOverlay:
      "🙏 Requests in keigo: seek consent, be specific, keep it brief.",
    inactivityNudge: (phase: Phase) => {
      if (phase === "intro")
        return "Say 'OK' to start with a soft permission line.";
      if (phase === "whiteboard_gate")
        return "Now repeat using your real item (file/link/agenda).";
      return "Ask for permission or a review using keigo in ≤2 sentences.";
    },
  },

  objectives: [
    "Ask for permission without pressure",
    "Request checks/reviews politely",
    "Invite guidance using humble forms",
  ],

  phrases: [
    {
      jp: "差し支えなければ、資料を共有させていただいてもよろしいでしょうか。",
      romaji:
        "Sashitsukae nakereba, shiryō o kyōyū sasete itadaite mo yoroshii deshō ka.",
      gloss: "If it’s alright, may I share the materials?",
      note: "Consent-seeking with 〜させていただく + 〜てもよろしいでしょうか。",
    },
    {
      jp: "ご確認いただけますと幸いです。",
      romaji: "Go-kakunin itadakemasu to saiwai desu.",
      gloss: "We’d appreciate your review.",
      note: "Polite request; ‘幸いです’ softens impact.",
    },
    {
      jp: "許可を頂戴してもよろしいでしょうか。",
      romaji: "Kyoka o chōdai shite mo yoroshii deshō ka.",
      gloss: "May we have your permission?",
      note: "‘頂戴する’ is humble for ‘receive’.",
    },
    {
      jp: "具体的なご要望があればご教示いただけますと幸いです。",
      romaji:
        "Gutaiteki na go-yōbō ga areba go-kyōji itadakemasu to saiwai desu.",
      gloss: "If you have specific requests, we’d appreciate your guidance.",
      note: "‘ご教示いただく’ politely asks for instruction.",
    },
  ],

  roleplays: [
    {
      scene: "Meeting: ask to share screen",
      yourGoal: "Request permission to share a deck and ask for feedback",
      partnerRole: "Client",
      prompt:
        "Politely ask to share your screen and request a brief review of page 5.",
      successHint:
        "Start 差し支えなければ…共有させていただいてもよろしいでしょうか; then ご確認いただけますと幸いです。",
    },
    {
      scene: "Slack/Chat: ask for access",
      yourGoal: "Request permission to access a repo/document",
      partnerRole: "Team lead",
      prompt:
        "Ask for permission and invite any specific requirements they have.",
      successHint:
        "Use 許可を頂戴してもよろしいでしょうか; add 具体的なご要望があればご教示いただけますと幸いです。",
    },
  ],
} satisfies ScenarioPrompts;
