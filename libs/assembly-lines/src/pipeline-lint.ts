// What a pipeline must hold to run at all, and why each rule: specs/7-feature-planning FR-20.

import type { AgentPrompts } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import {
  ambiguousEdges,
  deadEnds,
  undeclaredOutcomes,
  unreachableNodes,
  unroutedOutcomes,
} from "./pipeline-graph-rules.js";
import {
  problem,
  readPipeline,
  stationOf,
  type Checked,
  type Node,
  type PipelineProblem,
  type PipelineRule,
  type Station,
} from "./pipeline-lint-shape.js";

export type { PipelineProblem, PipelineRule };

// The floor fills these from the run itself, so no line declares them.
const FLOOR_SUPPLIED = new Set(["context", "description", "prompt"]);

const PLACEHOLDER = /\{([a-z_][a-z0-9_]*)\}/g;

export function pipelineProblems(
  yamlText: string,
  prompts: AgentPrompts,
): PipelineProblem[] {
  const checked = readPipeline(yamlText);

  if (!checked) {
    return [];
  }
  const { nodes } = checked.line;

  return [
    ...unkeyedLine(checked),
    ...ambiguousEdges(checked),
    ...undeclaredOutcomes(checked),
    ...nodes.flatMap((node) => nodeProblems(checked, node, prompts)),
    ...deadEnds(checked),
    ...unreachableNodes(checked),
  ];
}

// A run keyed on nothing cannot be the one run for its subject, so two starters make two.
function unkeyedLine(checked: Checked): PipelineProblem[] {
  const keys = Object.entries(checked.line.args)
    .filter(([, arg]) => arg.subject === true)
    .map(([name]) => name);

  if (keys.length === 1) {
    return [];
  }

  return [problem(checked, undefined, "unkeyed-line", unkeyedDetail(keys))];
}

function unkeyedDetail(keys: string[]): string {
  return keys.length === 0
    ? "no arg carries subject: true, so the floor cannot refuse a second run for the same subject"
    : `${keys.join(", ")} all carry subject: true, and a run has one subject`;
}

function nodeProblems(
  checked: Checked,
  node: Node,
  prompts: AgentPrompts,
): PipelineProblem[] {
  const station = stationOf(checked, node);

  if (!station) {
    return [];
  }

  return [
    ...unroutedOutcomes(checked, node, station),
    ...unsuppliedInputs(checked, node, station, prompts),
  ];
}

// A recipe reused from another line reads inputs this line may never put in the bag.
function unsuppliedInputs(
  checked: Checked,
  node: Node,
  station: Station,
  prompts: AgentPrompts,
): PipelineProblem[] {
  const definition = station.agent_definition ?? node.station ?? "";
  const missing = missingInputsOf(checked, station, prompts.get(definition));

  return missing.length === 0
    ? []
    : [
        problem(
          checked,
          node.id,
          "unsupplied-input",
          unsuppliedDetail(definition, missing),
        ),
      ];
}

function missingInputsOf(
  checked: Checked,
  station: Station,
  prompt: string | null | undefined,
): string[] {
  return station.kind === "agent" && prompt
    ? unsuppliedPlaceholders(prompt, suppliedNames(checked, station))
    : [];
}

function unsuppliedDetail(definition: string, missing: string[]): string {
  return `the ${definition} recipe reads ${missing.join(", ")}, which neither this line's args nor the node's needs supply`;
}

function unsuppliedPlaceholders(
  prompt: string,
  supplied: Set<string>,
): string[] {
  const named = new Set(
    [...prompt.matchAll(PLACEHOLDER)].map(([, name]) => name as string),
  );

  return (
    [...named]
      .filter((name) => !FLOOR_SUPPLIED.has(name))
      .filter((name) => !supplied.has(name))
      // A file item named `ticket` is read as `{ticket_path}`, where the floor put it.
      .filter((name) => !supplied.has(name.replace(/_path$/, "")))
      .sort()
  );
}

function suppliedNames(checked: Checked, station: Station): Set<string> {
  return new Set([
    ...Object.keys(checked.line.args),
    ...namesOf(station.needs),
    ...namesOf(station.produces),
  ]);
}

function namesOf(bagItems: { name?: string }[]): string[] {
  return bagItems
    .map((bagItem) => bagItem.name)
    .filter((name): name is string => typeof name === "string");
}
