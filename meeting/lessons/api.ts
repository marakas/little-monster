// lessons/api.ts
import type { LessonResponse } from "./types.ts";

const BASE =
  process.env.LESSONS_API_BASE ?? "https://little-monster.fly.dev/api/lessons";

type AuthQuery = { userId?: string; email?: string };

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = process.env.LESSONS_API_KEY;
  if (!apiKey) {
    // Fail fast with a helpful message
    throw new Error("LESSONS_API_KEY is not set (needed for x-api-key)");
  }
  headers["x-api-key"] = apiKey;
  return headers;
}

export async function fetchLessonOrThrow(
  lessonId: string,
  auth: AuthQuery
): Promise<LessonResponse> {
  const params = new URLSearchParams();
  if (auth?.userId) params.set("user_id", auth.userId);
  else if (auth?.email) params.set("email", auth.email);

  const url = `${BASE}/${encodeURIComponent(lessonId)}${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  const headers = buildHeaders();

  const resp = await fetch(url, { method: "GET", headers });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`Lesson fetch failed: ${resp.status} ${text || ""}`.trim());
  }

  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Lesson fetch failed: invalid JSON body");
  }

  const ok =
    json &&
    typeof json === "object" &&
    "lesson" in json &&
    "units" in json &&
    Array.isArray((json as any).units);
  if (!ok) throw new Error("Invalid lesson payload shape");

  const data = json as LessonResponse;
  if (!data.lesson?.id || data.lesson.status !== "ready") {
    throw new Error("Lesson not ready or invalid");
  }
  return data;
}
