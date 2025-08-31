// control/vision.analyzer.ts
import { readFile } from "node:fs/promises";
import OpenAI from "openai";

export type VisionState = "none" | "blank" | "has_content" | "unknown";

// Strict app allowlist (remove generic/broad terms)
const ALLOWED_APPS = [
  "miro",
  "excalidraw",
  "jamboard",
  "figma",
  "draw.io",
  "diagrams.net",
  "lucid",
  "lucidchart",
  "whimsical",
  "notion",
];

// Hosts we treat as whiteboard/diagram apps
const ALLOWED_HOSTS = [
  "miro.com",
  "excalidraw.com",
  "figma.com",
  "draw.io",
  "app.diagrams.net",
  "diagrams.net",
  "lucid.app",
  "lucidchart.com",
  "whimsical.com",
  "notion.so",
];

const WHITEBOARD_CTRL_HINTS = [
  "pen",
  "draw",
  "marker",
  "brush",
  "highlighter",
  "shapes",
  "rectangle",
  "arrow",
  "connector",
  "sticky",
  "post-it",
  "text tool",
  "frame",
  "frames",
  "layers",
  "mini-map",
  "minimap",
  "toolbar",
  "left sidebar",
  "top bar",
  "grid",
  "zoom",
  "zoom control",
  "hand tool",
  "pan tool",
];

const MEETING_UI_HINTS = [
  "google meet",
  "present now",
  "you are presenting",
  "stop presenting",
  "leave call",
  "turn on microphone",
  "turn off microphone",
  "captions",
  "meeting details",
  "zoom",
  "microsoft teams",
  "teams",
];

// --- Temporal stabilizer knobs (env-tunable) ---
const LATCH_MS = Number(process.env.VISION_LATCH_MS || 8000); // keep "present" for this long after last positive
const CLEAR_STREAK = Number(process.env.VISION_CLEAR_STREAK || 2); // how many consecutive "none" frames to truly clear

// --- Stabilizer state (module-local; worker lives per session) ---
let lastPresentAt = 0;
let lastAcceptedState: VisionState = "blank";
let noneStreak = 0;

type VisionResult = {
  state: VisionState;
  app: string | null;
  componentsCount: number;
  summary: string;
};

// Apply hysteresis so brief misses don't drop to "none"
function applyTemporalStabilizer(res: VisionResult): VisionResult {
  const now = Date.now();

  // Positive detections reset the latch and streak
  if (res.state === "blank" || res.state === "has_content") {
    lastPresentAt = now;
    lastAcceptedState = res.state;
    noneStreak = 0;
    return res;
  }

  // res.state === "none": if within grace window and not too many misses, hold last good
  if (now - lastPresentAt <= LATCH_MS && noneStreak < CLEAR_STREAK) {
    noneStreak++;
    const heldState = lastAcceptedState || "blank";
    return {
      state: heldState,
      app: null, // app isn’t important; avoid confusing logs
      componentsCount: 0,
      summary: canonicalSummary({
        present: true,
        state: heldState === "has_content" ? "has_content" : "blank",
        app: null,
        components: 0,
        modelSummary: res.summary,
      }),
    };
  }

  // Truly none: increment streak and pass through
  noneStreak++;
  return res;
}

function looksLikeMeetingUI(s: string): boolean {
  const t = s.toLowerCase();
  return MEETING_UI_HINTS.some((k) => t.includes(k));
}
function looksLikeIllustrationNotDiagram(s: string): boolean {
  const t = s.toLowerCase();
  return /(character|illustration|avatar|profile (icon|picture)|emoji|sticker)/.test(
    t
  );
}
function countControlHits(arr: unknown): number {
  const items = Array.isArray(arr)
    ? arr.map((x) => String(x).toLowerCase())
    : [];
  return items.filter((c) => WHITEBOARD_CTRL_HINTS.some((h) => c.includes(h)))
    .length;
}
function extractHostLike(str: string): string | null {
  try {
    // Handle bare hosts like "miro.com/board/..." too
    const m = str.match(
      /\b((?:[a-z0-9-]+\.)+[a-z]{2,}|localhost)(?::\d+)?(?:\/[^\s]*)?/i
    );
    if (!m) return null;
    const host = m[1].toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}
function normalizeAppName(s: string | null): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.includes("diagrams.net")) return "diagrams.net";
  if (t.includes("draw.io")) return "draw.io";
  if (t.includes("lucid")) return "lucidchart";
  if (t.includes("miro")) return "miro";
  if (t.includes("excalidraw")) return "excalidraw";
  if (t.includes("jamboard")) return "jamboard";
  if (t.includes("figma")) return "figma";
  if (t.includes("whimsical")) return "whimsical";
  if (t.includes("notion")) return "notion";
  // intentionally NOT mapping "canvas" or "whiteboard"
  return t;
}

async function fileToBase64(p: string): Promise<string> {
  const buf = await readFile(p);
  return buf.toString("base64");
}

/** extract output text robustly if `output_text` is missing */
function extractOutputText(resp: any): string | null {
  if (resp?.output_text && typeof resp.output_text === "string")
    return resp.output_text;
  const out = resp?.output;
  if (Array.isArray(out)) {
    const texts: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c?.text === "string") texts.push(c.text);
        }
      }
    }
    if (texts.length) return texts.join("\n");
  }
  const c0 = resp?.content?.[0]?.text;
  if (typeof c0 === "string" && c0.length) return c0;
  return null;
}

// --- Structured Outputs schema (Responses API: text.format) ---
function textFormatJsonSchema() {
  return {
    type: "json_schema" as const,
    name: "WhiteboardDetection",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ui_context: { type: "string", enum: ["meeting", "app", "unknown"] },
        whiteboard_present: { type: "boolean" },
        whiteboard_state: {
          type: "string",
          enum: ["blank", "has_content", "unknown"],
        },
        whiteboard_app: { type: ["string", "null"] },
        evidence: {
          type: "object",
          additionalProperties: false,
          properties: {
            words: { type: "array", items: { type: "string" } },
            controls: { type: "array", items: { type: "string" } },
            watermarks: { type: "array", items: { type: "string" } },
            url_like: { type: "array", items: { type: "string" } },
          },
          required: ["words", "controls", "watermarks", "url_like"],
        },
        components_count: { type: "integer", minimum: 0 },
        summary: { type: "string" },
      },
      required: [
        "ui_context",
        "whiteboard_present",
        "whiteboard_state",
        "whiteboard_app",
        "evidence",
        "components_count",
        "summary",
      ],
    },
  };
}
function buildSystemPrompt() {
  return [
    "You classify MEETING screenshots for a system-design interview.",
    "Most frames will show only Google Meet/Zoom/Teams UI with NO whiteboard.",
    "Only mark a whiteboard present if there is hard visual evidence:",
    "- a recognized app/host (miro/excalidraw/figma/draw.io/diagrams.net/lucid/whimsical/notion), or",
    "- at least two whiteboard/diagram controls (pen/shapes/sticky/frames/layers/zoom/minimap),",
    "otherwise whiteboard_present=false.",
    "The summary MUST NOT contradict whiteboard_present.",
    "If whiteboard_present=false, the summary MUST begin with: 'No whiteboard detected.'",
    "If whiteboard_present=true and whiteboard_state='blank', the summary MUST begin with: 'Whiteboard detected (blank).'",
    "If whiteboard_present=true and whiteboard_state='has_content', the summary MUST begin with: 'Whiteboard detected (has content).'",
    "Follow the JSON schema exactly when structured output is requested.",
  ].join(" ");
}

function buildUserInstruction() {
  return [
    "Determine if a WHITEBOARD is visible even if it's being shared inside a meeting UI.",
    "If visible, set whiteboard_present=true and classify whiteboard_state (blank vs has_content).",
    "Extract app name if visible; fill evidence.words (UI text), evidence.controls (tools),",
    "evidence.url_like (hostnames/URLs), evidence.watermarks (brand text).",
    "Estimate components_count if a diagram exists. Keep summary ≤ 280 chars.",
    "The summary must follow the consistency rules in the system message.",
  ].join(" ");
}

function canonicalSummary(decision: {
  present: boolean;
  state: "blank" | "has_content" | "unknown";
  app: string | null; // kept for signature compatibility, but not shown
  components: number;
  modelSummary: string;
}) {
  if (!decision.present) return "No whiteboard detected.";
  const prefix =
    decision.state === "has_content"
      ? "Whiteboard detected (has content)."
      : "Whiteboard detected (blank).";
  const comps =
    decision.state === "has_content" && decision.components > 0
      ? ` ~${decision.components} components.`
      : "";
  return `${prefix}${comps}`;
}

async function callStructured(
  client: OpenAI,
  model: string,
  b64: string
): Promise<any> {
  const resp = await client.responses.create({
    model,
    text: {
      format: textFormatJsonSchema(),
    },
    input: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: [
          { type: "input_text", text: buildUserInstruction() },
          {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${b64}`,
            detail: "auto",
          },
        ],
      },
    ],
  });
  const txt = extractOutputText(resp);
  if (!txt) throw new Error("no-structured-output");
  return JSON.parse(txt);
}

async function callJsonModeFallback(
  client: OpenAI,
  model: string,
  b64: string
): Promise<any> {
  const resp = await client.responses.create({
    model,
    text: {
      format: { type: "json_object" },
    },
    input: [
      {
        role: "system",
        content:
          buildSystemPrompt() +
          " Return ONLY a single JSON object with the keys: " +
          "ui_context, whiteboard_present, whiteboard_state, whiteboard_app, evidence{words,controls,watermarks,url_like}, components_count, summary.",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: buildUserInstruction() },
          {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${b64}`,
            detail: "auto",
          },
        ],
      },
    ],
  });
  const txt = extractOutputText(resp);
  if (!txt) throw new Error("no-json-output");
  return JSON.parse(txt);
}

/**
 * Meeting-aware whiteboard detector (Structured Outputs with JSON fallback)
 * Evidence-first: we DO NOT trust the model's narrative summary as evidence.
 */
export async function analyzeWhiteboardFromImage(
  filePath: string,
  opts?: { client?: OpenAI; model?: string; debug?: boolean }
): Promise<{
  state: VisionState;
  app: string | null;
  componentsCount: number;
  summary: string;
}> {
  const client =
    opts?.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = opts?.model ?? process.env.VISION_MODEL ?? "gpt-4o-mini";
  const b64 = await fileToBase64(filePath);

  let parsed: any | null = null;
  try {
    parsed = await callStructured(client, model, b64);
  } catch (e: any) {
    try {
      parsed = await callJsonModeFallback(client, model, b64);
    } catch (e2: any) {
      if (opts?.debug || process.env.VISION_DEBUG === "1") {
        console.warn(
          "[vision] both structured + json fallback failed:",
          String(e2?.message || e2)
        );
      }
      return { state: "none", app: null, componentsCount: 0, summary: "" };
    }
  }

  // Extract
  const uiContext: "meeting" | "app" | "unknown" =
    parsed.ui_context === "meeting" || parsed.ui_context === "app"
      ? parsed.ui_context
      : "unknown";

  const whiteboardPresent: boolean = Boolean(parsed.whiteboard_present);
  const wbStateRaw =
    parsed.whiteboard_state === "blank" ||
    parsed.whiteboard_state === "has_content"
      ? parsed.whiteboard_state
      : "unknown";

  const appNorm = normalizeAppName(
    parsed.whiteboard_app === null || typeof parsed.whiteboard_app === "string"
      ? parsed.whiteboard_app
      : null
  );

  const ev = parsed.evidence || {};
  const evWords: string[] = Array.isArray(ev.words) ? ev.words.map(String) : [];
  const evControls: string[] = Array.isArray(ev.controls)
    ? ev.controls.map(String)
    : [];
  const evURLs: string[] = Array.isArray(ev.url_like)
    ? ev.url_like.map(String)
    : [];
  const evWater: string[] = Array.isArray(ev.watermarks)
    ? ev.watermarks.map(String)
    : [];

  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  const componentsCount =
    typeof parsed.components_count === "number" && parsed.components_count >= 0
      ? parsed.components_count
      : 0;

  // Derived evidence (OCR’ed strings only; DO NOT use summary as evidence)
  const allStringsLower = [...evWords, ...evURLs, ...evWater].map((s) =>
    s.toLowerCase()
  );
  const hostHits = allStringsLower
    .map((s) => extractHostLike(s))
    .filter(Boolean) as string[];

  const hostOk = hostHits.some((h) => ALLOWED_HOSTS.includes(h));
  const appByStrings =
    allStringsLower.find((s) => ALLOWED_APPS.some((a) => s.includes(a))) ||
    appNorm ||
    null;
  const appOk = appByStrings
    ? ALLOWED_APPS.some((a) => (appByStrings as string).includes(a))
    : false;
  const ctrlHits = countControlHits(evControls);

  const isMeetingUI =
    uiContext === "meeting" ||
    looksLikeMeetingUI(summary) ||
    allStringsLower.some((s) => looksLikeMeetingUI(s));

  if (opts?.debug || process.env.VISION_DEBUG === "1") {
    console.log(
      `[vision] evidence appOk=${appOk} hostOk=${hostOk} ctrlHits=${ctrlHits} meetingUI=${isMeetingUI} ` +
        `strings=${JSON.stringify(
          allStringsLower.slice(0, 8)
        )} urls=${JSON.stringify(hostHits)}`
    );
  }

  // --- Decision logic (evidence-first) ---

  // If model claims board present, accept ONLY with strong evidence (app/host OR ≥2 controls)
  if (whiteboardPresent && (appOk || hostOk || ctrlHits >= 2)) {
    const state: VisionState =
      wbStateRaw === "blank"
        ? "blank"
        : wbStateRaw === "has_content"
        ? "has_content"
        : componentsCount > 0
        ? "has_content"
        : "blank";

    const finalState =
      state === "has_content" && looksLikeIllustrationNotDiagram(summary)
        ? ("blank" as const)
        : state;

    const out: VisionResult = {
      state: finalState,
      app: appByStrings,
      componentsCount,
      summary: canonicalSummary({
        present: true,
        state: finalState === "has_content" ? "has_content" : "blank",
        app: appByStrings,
        components: componentsCount,
        modelSummary: summary,
      }),
    };
    return applyTemporalStabilizer(out);
  }

  // If in meeting UI, accept ONLY with strong evidence
  if (isMeetingUI && (appOk || hostOk || ctrlHits >= 2)) {
    const state: VisionState =
      wbStateRaw === "has_content" || componentsCount > 0
        ? "has_content"
        : "blank";

    const out: VisionResult = {
      state,
      app: appByStrings,
      componentsCount,
      summary: canonicalSummary({
        present: true,
        state: state === "has_content" ? "has_content" : "blank",
        app: appByStrings,
        components: componentsCount,
        modelSummary: summary,
      }),
    };
    return applyTemporalStabilizer(out);
  }

  // Otherwise, treat as none
  const out: VisionResult = {
    state: "none",
    app: null,
    componentsCount: 0,
    summary: canonicalSummary({
      present: false,
      state: "unknown",
      app: null,
      components: 0,
      modelSummary: summary,
    }),
  };
  return applyTemporalStabilizer(out);
}
