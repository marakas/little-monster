// scenarios/index.ts
import type { ScenarioPrompts } from "./types";
import jpIntro from "./japanese_intro.ts";
import triangle from "./triangle_test.ts";

const registry: Record<string, ScenarioPrompts> = {
  "jp-intro": jpIntro,
  triangle,
};

export function getScenario(
  key = process.env.SCENARIO || "jp-intro"
): ScenarioPrompts {
  return registry[key] ?? jpIntro;
}
