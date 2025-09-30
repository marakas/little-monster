// public/js/webrtc.js
import { OpenAIRealtimeWebRTC } from "https://esm.run/@openai/agents-realtime";

/**
 * Prepare the microphone and an <audio> element for playback.
 * Mirrors the original logic (permissions, element setup, event logs).
 * Returns { mic, audioEl }.
 */
export async function prepareMic({ log } = {}) {
  let mic = await navigator.mediaDevices.getUserMedia({ audio: true });

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.controls = true;
  audioEl.muted = false;
  audioEl.volume = 1.0;
  document.body.appendChild(audioEl);

  try {
    if (audioEl.setSinkId) await audioEl.setSinkId("default");
  } catch {}

  if (log) {
    audioEl.addEventListener("playing", () => log("[audio] playing"));
    audioEl.addEventListener("pause", () => log("[audio] paused"));
    audioEl.addEventListener("error", (e) =>
      log("[audio] error", e?.message || e)
    );
  }

  // Keep this side-effect to preserve original behavior.
  window.__micReady = true;

  if (log) log("Mic prepared (no AI connection yet).");
  return { mic, audioEl };
}

/**
 * Create the OpenAI WebRTC transport (no session yet).
 * Matches original instantiation.
 */
export function createTransport({ mediaStream, audioElement }) {
  return new OpenAIRealtimeWebRTC({
    mediaStream,
    audioElement,
  });
}

/**
 * Attach PeerConnection debug handlers + track routing to audioEl.
 * Identical to original behavior.
 */
export function attachPcDebugHandlers({ transport, audioElement, log }) {
  try {
    const pc = transport?.pc;
    if (!pc) return;

    if (log) {
      pc.onconnectionstatechange = () => log("[pc] state:", pc.connectionState);
      pc.oniceconnectionstatechange = () =>
        log("[pc] ice:", pc.iceConnectionState);
    }

    pc.ontrack = (e) => {
      if (log) log("[pc] ontrack:", e.track?.kind);
      if (e.streams && e.streams[0]) {
        audioElement.srcObject = e.streams[0];
        audioElement
          .play()
          .catch(
            (err) => log && log("[audio] play() error:", err?.message || err)
          );
      }
    };
  } catch {}
}
