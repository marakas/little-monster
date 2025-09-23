// units/index.ts
import type { IUnitRunner } from "./base.ts";
import { VocabRunner } from "./vocab.ts";
import { SpeakingRunner } from "./speaking.ts";
import { ConversationRunner } from "./conversation.ts";

export const RUNNERS: IUnitRunner[] = [
  VocabRunner,
  SpeakingRunner,
  ConversationRunner,
];

export function getRunner(type: IUnitRunner["type"]): IUnitRunner | undefined {
  return RUNNERS.find((r) => r.type === type);
}
