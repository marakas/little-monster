//sessions/realtimeSessions.ts
import {
  initRealtime,
  setRealtimeArmed,
  clearInputBuffer,
  closeRealtime,
} from "../realtimeClient.ts";

export async function openRealtimeSession(
  baseInstructions?: string,
  voice?: string
) {
  const base =
    (baseInstructions && baseInstructions.trim()) ||
    "SYSTEM: Do not initiate freeform conversation. Only speak when a response is created.";
  await initRealtime(process.env.OPENAI_API_KEY!, {
    baseInstructions: base,
    voice,
  });
  setRealtimeArmed(false);
  clearInputBuffer();
}

export async function closeRealtimeSession() {
  try {
    await closeRealtime();
  } catch {}
}
