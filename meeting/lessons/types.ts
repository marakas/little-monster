// lessons/types.ts
export type LessonUnitType = "vocab" | "speaking" | "conversation";

export type LessonItem = {
  id: string;
  unit_id: string;
  jp: string;
  en: string;
  description?: string | null;
  example_jp?: string | null;
  example_en?: string | null;
  audio_url?: string | null;
};

export type ConversationTurn = {
  id: string;
  unit_id: string;
  speaker: "bot" | "user";
  jp: string;
  en: string;
  order_index: number;
  audio_url?: string | null;
};

export type LessonUnit = {
  id: string;
  lesson_id: string;
  type: LessonUnitType;
  intro_text?: string | null;
  items?: LessonItem[]; // for vocab/speaking
  turns?: ConversationTurn[]; // for conversation
  created_at: string;
};

export type LessonMeta = {
  id: string;
  user_id: string;
  level: string;
  focus: string;
  notes?: string | null;
  status: string; // "ready"
  created_at: string;
  ready_at?: string | null;
  error?: string | null;
};

export type LessonResponse = {
  lesson: LessonMeta;
  units: LessonUnit[];
};
