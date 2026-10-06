// @re-cinq/lore-assembly-lines — the floor pipeline files (`src/floor-pipelines/*.yaml`, copied beside dist) and the few parsers Lore's floor stations share: the review verdict, an agent's result text, and the log line a station prints. The definition loader and the transition replay of the engine Lore ran itself were deleted on 2026-10-02.

export {
  type StageOutcome,
  type NodeResult,
  type NodeLlmUsage,
} from "./node-types.js";

export { parseReviewVerdict } from "./node-outcome.js";

export { resultTextFromOutput, eventLine } from "./agent-output.js";
