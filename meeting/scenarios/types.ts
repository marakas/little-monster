// scenarios/types.ts
export type Phase = "intro" | "whiteboard_gate" | "interview";

export type ScenarioPrompts = {
  key: string; // e.g. "jp-intro"
  title: string; // human-readable
  base: string; // general role & scope
  sticky: string; // always-on guardrails
  stage: Record<Phase, string>; // phase-specific guidance
  greetingLine: string; // one-shot greeting spoken via speakOnce(...)
  overlays?: {
    helloOverlay?: string;
    inactivityNudge: (phase: Phase) => string;
  };
};
