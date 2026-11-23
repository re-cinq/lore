import type { Pipeline } from "@re-cinq/floor-pipeline";
import {
  agentsOverlay,
  type OverlayAgent,
  type PackOverlayInput,
} from "./pack-agents.js";
import { skillsOverlay, type OverlaySkill } from "./pack-skills.js";
import { pipelinesOverlay } from "./pack-pipelines.js";
import { isPackFile, isReadPath } from "./pack-paths.js";
import type { Refusal } from "./pack-refusal.js";

export type {
  AgentSource,
  OverlayAgent,
  PackOverlayInput,
  ShippedCatalog,
} from "./pack-agents.js";
export type { OverlaySkill, SkillSource } from "./pack-skills.js";
export type { Refusal } from "./pack-refusal.js";

export interface PackOverlay {
  agents: Map<string, OverlayAgent>;
  pipelines: Pipeline[];
  /** The id of each line in `pipelines`. */
  lineIds: string[];
  skills: Map<string, OverlaySkill>;
  counts: {
    agents: number;
    pipelines: number;
    extensions: number;
    skills: number;
  };
  refused: Refusal[];
}

/** What Lore ships and what the pack supplies, combined: computed in memory, with no floor in reach. */
export function packOverlay(input: PackOverlayInput): PackOverlay {
  const agentsSet = agentsOverlay(input);
  const pipelinesSet = pipelinesOverlay(input, agentsSet.agents);
  const skillsSet = skillsOverlay(input);
  const { agents } = agentsSet;
  const { pipelines } = pipelinesSet;
  const { skills } = skillsSet;

  return {
    agents,
    pipelines,
    lineIds: pipelines.map((pipeline) => pipeline.line?.id ?? ""),
    skills,
    refused: byPath([
      ...[agentsSet, skillsSet, pipelinesSet].flatMap((set) => set.refused),
      ...unreadPathsOf(input),
    ]),
    counts: countsOf(agents, pipelines, skills),
  };
}

function countsOf(
  agents: PackOverlay["agents"],
  pipelines: PackOverlay["pipelines"],
  skills: PackOverlay["skills"],
): PackOverlay["counts"] {
  return {
    agents: agents.size,
    pipelines: pipelines.length,
    extensions: extensionsIn(agents),
    skills: skills.size,
  };
}

function extensionsIn(agents: PackOverlay["agents"]): number {
  return [...agents.values()].filter((agent) => agent.source === "extended")
    .length;
}

const UNREAD_PATH =
  "Lore does not read this path: a line folder holds assembly-line.yaml, agents/<agent>.md and agents/<agent>.extra.md, and skills/ holds <name>.md";

/** A file in a line folder that Lore would skip in silence: a misspelt name must show, not quietly do nothing. */
function unreadPathsOf({ files }: PackOverlayInput): Refusal[] {
  const unread = files.filter(
    (file) => isPackFile(file.path) && !isReadPath(file.path),
  );

  return unread.map((file) => ({ path: file.path, reason: UNREAD_PATH }));
}

function byPath(refused: Refusal[]): Refusal[] {
  return refused.sort((a, b) => a.path.localeCompare(b.path));
}
