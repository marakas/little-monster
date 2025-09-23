// sessions/realtimeSession.ts
import {
  initRealtime,
  setRealtimeArmed,
  clearInputBuffer,
} from "../realtimeClient.ts";

// If not present yet, add this in realtimeClient.ts and export it:
// export async function closeRealtime() { try { await client?.close?.(); } catch {} }
import { closeRealtime } from "../realtimeClient.ts";

export async function openRealtimeSession() {
  await initRealtime(process.env.OPENAI_API_KEY!);
  setRealtimeArmed(true);
  clearInputBuffer();
}

export async function closeRealtimeSession() {
  try {
    await closeRealtime();
  } catch {}
}
