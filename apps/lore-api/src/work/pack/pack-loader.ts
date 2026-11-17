import type { Pipeline } from "@re-cinq/floor-pipeline";
import {
  agentsOverlay,
  type OverlayAgent,
  type PackOverlayInput,
} from "./pack-agents.js";
import { pipelinesOverlay } from "./pack-pipelines.js";
import type { Refusal } from "./pack-refusal.js";

export type {
  AgentSource,
  OverlayAgent,
  PackOverlayInput,
  ShippedCatalog,
} from "./pack-agents.js";
export type { Refusal } from "./pack-refusal.js";

export interface PackOverlay {
  agents: Map<string, OverlayAgent>;
  pipelines: Pipeline[];
  counts: { agents: number; pipelines: number; extensions: number };
  refused: Refusal[];
}

/** What Lore ships and what the pack supplies, combined: computed in memory, with no floor in reach. */
export function packOverlay(input: PackOverlayInput): PackOverlay {
  const { agents, refused: agentRefusals } = agentsOverlay(input);
  const { pipelines, refused: pipelineRefusals } = pipelinesOverlay(
    input,
    agents,
  );

  return {
    agents,
    pipelines,
    refused: [...agentRefusals, ...pipelineRefusals],
    counts: {
      agents: agents.size,
      pipelines: pipelines.length,
      extensions: [...agents.values()].filter(
        (agent) => agent.source === "extended",
      ).length,
    },
  };
}
