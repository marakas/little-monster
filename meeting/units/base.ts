// units/base.ts
import type { PageLike } from "../types/page-like.ts";
import type { LessonResponse, LessonUnit } from "../lessons/types.ts";

export type UnitContext = {
  page: PageLike; // Meet page (for overlays if needed)
  lesson: LessonResponse;
  meetingId: string;
};

export type UnitRunOptions = {
  maxDurationMs: number; // hard stop per unit
  useRealtime: boolean; // if true, open/close a Realtime session for this unit
  signal?: AbortSignal; // for global cancellation (stopMeetBot)
};

export interface IUnitRunner {
  readonly type: LessonUnit["type"];
  run(ctx: UnitContext, unit: LessonUnit, opts: UnitRunOptions): Promise<void>;
}
