// public/js/realtime.js
import {
  RealtimeAgent,
  RealtimeSession,
} from "https://esm.run/@openai/agents-realtime";

/**
 * Factory that returns a stable API to manage the OpenAI Realtime session.
 * It preserves all original behaviors, events, and helper flows.
 */
export function createRealtimeApi({
  log = () => {},
  onSpeakStateChange = () => {},
} = {}) {
  let session = null;
  let responseInFlight = false;
  let agentSpeaking = false;
  const listeners = new Set();
  let baseInstructionsCurrent = "";

  function onEvent(cb) {
    listeners.add(cb);
  }
  function offEvent(cb) {
    listeners.delete(cb);
  }

  async function startSession({
    token,
    transport,
    baseInstructions,
    voice = "alloy",
    model = "gpt-4o-mini-transcribe",
  }) {
    if (session) return session;

    const agent = new RealtimeAgent({ name: "Instructor", instructions: "" });
    session = new RealtimeSession(agent, { transport });
    baseInstructionsCurrent = baseInstructions || "";

    // ---- Events (unchanged logic) ----
    session.on("event", (ev) => {
      if (ev?.type === "response.created") {
        agentSpeaking = true;
        responseInFlight = true;
        onSpeakStateChange(true);
      }
      if (
        ev?.type === "response.completed" ||
        ev?.type === "response.failed" ||
        ev?.type === "response.canceled"
      ) {
        agentSpeaking = false;
        responseInFlight = false;
        onSpeakStateChange(false);
      }
      if (ev?.type) log("[event]", ev.type);

      // fan-out
      listeners.forEach((cb) => {
        try {
          cb(ev);
        } catch {}
      });
    });

    session.on("response.failed", (e) =>
      log("[response.failed]", e?.error?.message || JSON.stringify(e))
    );

    session.on("input_audio_transcription.completed", (e) =>
      log("[asr]", e?.transcript)
    );

    session.transport.on("*", (ev) => {
      if (ev?.type === "error") {
        log("[transport error]", ev?.error?.message || JSON.stringify(ev));
      } else {
        log("[transport]", ev?.type || JSON.stringify(ev));
      }
    });

    await session.connect({ apiKey: token });

    // Initial config (unchanged)
    session.transport.sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        model,
        audio: { voice },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "high",
          create_response: false, // IMPORTANT: never auto-create on VAD
          interrupt_response: true,
        },
        instructions: baseInstructions,
      },
    });

    return session;
  }

  function setArmed(on) {
    if (!session) return;
    session.transport.sendEvent({
      type: "session.update",
      session: {
        turn_detection: {
          type: "semantic_vad",
          eagerness: "high",
          // keep same flags; UI logs happen outside
          create_response: false,
          interrupt_response: true,
        },
      },
    });
  }

  function updateInstructions(text, voice) {
    if (!session) return;
    const final = [baseInstructionsCurrent, text || ""].join("\n\n").trim();
    session.transport.sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: final,
        ...(voice ? { voice } : {}),
      },
    });
  }

  function speakOnce(instructions) {
    if (!session) return;
    const final = [baseInstructionsCurrent, instructions || ""]
      .join("\n\n")
      .trim();
    session.transport.sendEvent({
      type: "session.update",
      session: { type: "realtime", instructions: final },
    });
    session.transport.sendEvent({ type: "response.create" });
  }

  function waitForResponseDone(timeoutMs = 15000) {
    if (!responseInFlight) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const handler = (ev) => {
        if (
          ev?.type === "response.completed" ||
          ev?.type === "response.failed" ||
          ev?.type === "response.canceled"
        ) {
          if (done) return;
          done = true;
          offEvent(handler);
          resolve();
        }
      };
      onEvent(handler);
      setTimeout(() => {
        if (!done) {
          done = true;
          offEvent(handler);
          resolve();
        }
      }, timeoutMs);
    });
  }

  async function speakOnceAndWait(text) {
    speakOnce(text);
    responseInFlight = true;
    await waitForResponseDone();
  }

  function waitForUserSpeech({ timeoutMs = 7000 } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (txt) => {
        if (done) return;
        done = true;
        offEvent(handler);
        setArmed(false);
        resolve(txt);
      };
      const handler = (ev) => {
        if (
          ev?.type === "input_audio_transcription.completed" &&
          ev?.transcript
        ) {
          finish(String(ev.transcript));
        }
      };
      onEvent(handler);
      setArmed(true);
      setTimeout(() => finish(null), timeoutMs);
    });
  }

  return {
    // lifecycle
    startSession,

    // controls
    setArmed,
    updateInstructions,
    speakOnce,
    speakOnceAndWait,
    waitForUserSpeech,
    waitForResponseDone,

    // events (internal use by helpers)
    onEvent,
    offEvent,
  };
}
