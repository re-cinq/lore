// What a pipeline must hold to run at all, and why each rule: specs/7-feature-planning FR-20.

import type { AgentPrompts } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import {
  ambiguousEdges,
  danglingEdges,
  deadEnds,
  undeclaredOutcomes,
  unreachableNodes,
  unroutedOutcomes,
} from "./pipeline-graph-rules.js";
import {
  problem,
  readPipeline,
  stationOf,
  type BagItem,
  type Checked,
  type Node,
  type PipelineProblem,
  type PipelineRule,
  type Station,
} from "./pipeline-lint-shape.js";

export type { PipelineProblem, PipelineRule };

// The floor fills these from the run itself, so no line declares them.
const FLOOR_SUPPLIED = new Set(["context", "description", "prompt"]);

// Filled by the floor around a retry or a fan-out branch, never seeded or produced by a line.
const FLOOR_FILLED_NEEDS = new Set([
  "previous_error",
  "previous_failures",
  "item",
]);

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
    ...undeclaredBags(checked),
    ...ambiguousEdges(checked),
    ...undeclaredOutcomes(checked),
    ...nodes.flatMap((node) => nodeProblems(checked, node, prompts)),
    ...danglingEdges(checked),
    ...deadEnds(checked),
    ...unreachableNodes(checked),
  ];
}

// specs/7-feature-planning FR-20: the floor refuses a station missing either array with a 400 naming none.
function undeclaredBags(checked: Checked): PipelineProblem[] {
  return Object.entries(checked.stations)
    .map(([name, station]) => ({ name, missing: missingBags(station) }))
    .filter(({ missing }) => missing.length > 0)
    .map(({ name, missing }) =>
      problem(
        checked,
        undefined,
        "undeclared-bag",
        `station "${name}" declares no ${missing.join(" and no ")}; the floor requires both arrays`,
      ),
    );
}

function missingBags(station: Station): string[] {
  return [
    ...(station.needs ? [] : ["needs"]),
    ...(station.produces ? [] : ["produces"]),
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
    ...unseededNeeds(checked, node, station),
  ];
}

// The floor's own check (its line-needs.ts), which refused feature-planning on every boot for four days after #2886 removed the `base` arg two nodes still bound (#3487). A git need is only ever seeded, by a git arg. Any other need is seeded by an arg or a line file, or produced by a station; the floor further asks that a producer sits on EVERY path into the node, which this does not.
function unseededNeeds(
  checked: Checked,
  node: Node,
  station: Station,
): PipelineProblem[] {
  return (station.needs ?? [])
    .filter((need) => !need.optional && need.collect === undefined)
    .map((need) => ({ need, bagName: bagNameOf(node, need) }))
    .filter(({ bagName }) => !FLOOR_FILLED_NEEDS.has(bagName))
    .filter(({ need, bagName }) => !isSeeded(checked, need, bagName))
    .map(({ need, bagName }) =>
      problem(
        checked,
        node.id,
        "unseeded-need",
        unseededDetail(node, need, bagName),
      ),
    );
}

function bagNameOf(node: Node, need: BagItem): string {
  const name = need.name ?? "";

  return node.bind?.[name] ?? name;
}

function isSeeded(checked: Checked, need: BagItem, bagName: string): boolean {
  const { args, files } = checked.line;

  if (need.kind === "git") {
    return Object.entries(args).some(
      ([name, arg]) => name === bagName && arg.kind === "git",
    );
  }

  return (
    bagName in args ||
    bagName in (files ?? {}) ||
    producedNames(checked).has(bagName)
  );
}

function producedNames(checked: Checked): Set<string> {
  return new Set(
    Object.values(checked.stations).flatMap((station) =>
      namesOf(station.produces ?? []),
    ),
  );
}

function unseededDetail(node: Node, need: BagItem, bagName: string): string {
  const label =
    need.name === bagName
      ? `"${need.name}"`
      : `"${need.name}" (bound as "${bagName}")`;

  return need.kind === "git"
    ? `node "${node.id}" needs ${label} as kind "git", which nothing in the line seeds`
    : `node "${node.id}" needs ${label}, which nothing in the line seeds or produces`;
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
    ...namesOf(station.needs ?? []),
    ...namesOf(station.produces ?? []),
  ]);
}

function namesOf(bagItems: { name?: string }[]): string[] {
  return bagItems
    .map((bagItem) => bagItem.name)
    .filter((name): name is string => typeof name === "string");
}
