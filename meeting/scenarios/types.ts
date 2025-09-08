// scenarios/types.ts
export type Phase = "intro" | "whiteboard_gate" | "interview";

export type ScenarioPhrase = {
  jp: string; // Kana/Kanji
  romaji?: string; // Optional
  gloss?: string; // Short English gloss
  note?: string; // When/why to use, nuance
};

export type Roleplay = {
  scene: string; // e.g., "Phone: calling a client"
  yourGoal: string; // learner goal
  partnerRole: string; // what the bot plays
  prompt: string; // what the bot asks the learner to say/do
  successHint?: string; // target structure/keigo hint
};

export type ScenarioPrompts = {
  key: string;
  title: string;
  base: string;
  sticky: string;
  stage: Record<Phase, string>;
  greetingLine: string;
  overlays?: {
    helloOverlay?: string;
    inactivityNudge: (phase: Phase) => string;
  };

  // NEW (optional)
  objectives?: string[]; // short bullets
  phrases?: ScenarioPhrase[]; // key lines to teach/practice
  roleplays?: Roleplay[]; // one or more role-play scenes
};
