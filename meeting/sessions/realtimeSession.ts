//sessions/realtimeSessions.ts
import {
  initRealtime,
  setRealtimeArmed,
  clearInputBuffer,
  closeRealtime,
} from "../realtimeClient.ts";

export async function openRealtimeSession(baseInstructions?: string) {
  await initRealtime(process.env.OPENAI_API_KEY!, { baseInstructions });
  setRealtimeArmed(true);
  clearInputBuffer(); // once at start
}

export async function closeRealtimeSession() {
  try {
    await closeRealtime();
  } catch {}
}
