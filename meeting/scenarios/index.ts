// scenarios/index.ts
import type { ScenarioPrompts } from "./types";
import jpIntro from "./japanese_intro.ts";
import triangle from "./triangle_test.ts";
import keigo1 from "./jp_adv_keigo_1.ts";

const registry: Record<string, ScenarioPrompts> = {
  "jp-intro": jpIntro,
  triangle: triangle,
  "jp-adv:keigo-1": keigo1,
};

function keyFromEnv() {
  const explicit = process.env.SCENARIO;
  if (explicit) return explicit;

  // optional COURSE/LESSON pair
  const c = process.env.COURSE;
  const l = process.env.LESSON;
  if (c && l) return `${c}:${l}`;

  return "jp-adv:keigo-1"; // default to first advanced lesson (change if you prefer)
}

export function getScenario(key?: string): ScenarioPrompts {
  const k = key ?? keyFromEnv();
  return registry[k] ?? jpIntro;
}
