// control/control.schema.ts

// ---- Events Main -> Worker ----
export type ControlEvent =
  | { type: "HELLO"; meetingId?: string }
  | { type: "TICK"; ts: number }
  | {
      type: "TRANSCRIPT_APPENDED";
      ts: number;
      text: string;
    }
  | {
      type: "VISION_UPDATE";
      ts: number;
      state: "none" | "blank" | "has_content" | "unknown";
      summary?: string;
      componentsCount?: number;
    }
  | { type: "SESSION_END"; reason?: string };

// ---- Rubric types (Worker <-> Main) ----
export type RubricScore = {
  id: string;
  label: string;
  score: number; // 0..5
  justification: string;
};

export type RubricReport = {
  scenario: string;
  overall: number; // 0..100 weighted
  scores: RubricScore[];
  top_gaps: string[];
  suggested_next_question?: string;
  summary?: string;
  updated_at: number; // epoch ms
};

// ---- Actions Worker -> Main ----
export type ControlAction =
  | { type: "SET_OVERLAY"; text: string; ttlMs?: number }
  | {
      type: "SET_PHASE";
      phase: "intro" | "whiteboard_gate" | "interview";
      reason?: string;
    }
  | { type: "RUBRIC_UPDATE"; report: RubricReport }
  | { type: "END_REPORT"; report: RubricReport };
