// scenarios/index.ts
import type { ScenarioPrompts } from "./types";
import jpIntro from "./japanese_intro.ts";
import triangle from "./triangle_test.ts";
import keigo1 from "./jp_adv_keigo_1.ts";
import keigo2 from "./jp_adv_keigo_2.ts";
import keigo3 from "./jp_adv_keigo_3.ts";
import keigo4 from "./jp_adv_keigo_4.ts";
import keigo5 from "./jp_adv_keigo_5.ts";
import keigo6 from "./jp_adv_keigo_6.ts";

const registry: Record<string, ScenarioPrompts> = {
  "jp-intro": jpIntro,
  triangle: triangle,
  "jp-adv:keigo-1": keigo1,
  "jp-adv:keigo-2": keigo2,
  "jp-adv:keigo-3": keigo3,
  "jp-adv:keigo-4": keigo4,
  "jp-adv:keigo-5": keigo5,
  "jp-adv:keigo-6": keigo6,
};

function keyFromEnv() {
  const explicit = process.env.SCENARIO;
  console.log("Explicit scenario: ", explicit);
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
