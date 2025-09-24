import type { LessonResponse } from "./types.ts";

let currentLesson: LessonResponse | null = null;

export function setCurrentLesson(lesson: LessonResponse) {
  currentLesson = lesson;
}

export function getCurrentLesson(): LessonResponse | null {
  return currentLesson;
}
