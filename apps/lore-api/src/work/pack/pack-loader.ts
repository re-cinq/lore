import type { Pipeline } from "@re-cinq/floor-pipeline";
import {
  agentsOverlay,
  type OverlayAgent,
  type PackOverlayInput,
} from "./pack-agents.js";
import { pipelinesOverlay } from "./pack-pipelines.js";
import { isReadPath } from "./pack-paths.js";
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
  const agentsSet = agentsOverlay(input);
  const pipelinesSet = pipelinesOverlay(input, agentsSet.agents);
  const { agents } = agentsSet;
  const { pipelines } = pipelinesSet;

  return {
    agents,
    pipelines,
    refused: byPath([
      ...agentsSet.refused,
      ...pipelinesSet.refused,
      ...unreadPathsOf(input),
    ]),
    counts: {
      agents: agents.size,
      pipelines: pipelines.length,
      extensions: extensionsIn(agents),
    },
  };
}

function extensionsIn(agents: PackOverlay["agents"]): number {
  return [...agents.values()].filter((agent) => agent.source === "extended")
    .length;
}

const UNREAD_PATH =
  "Lore does not read this path: a line folder holds pipeline.yaml, agents/<agent>.md and agents/<agent>.extra.md";

/** A file in a line folder that Lore would skip in silence: a misspelt name must show, not quietly do nothing. */
function unreadPathsOf({ files }: PackOverlayInput): Refusal[] {
  const unread = files.filter((file) => !isReadPath(file.path));

  return unread.map((file) => ({ path: file.path, reason: UNREAD_PATH }));
}

function byPath(refused: Refusal[]): Refusal[] {
  return refused.sort((a, b) => a.path.localeCompare(b.path));
}
