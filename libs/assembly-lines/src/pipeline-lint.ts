// Why each rule: specs/7-feature-planning FR-20.

import type { AgentPrompts } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import { parse } from "yaml";
import { z } from "zod";

export type PipelineRule =
  | "ambiguous-edge"
  | "outcome-without-edge"
  | "unkeyed-line"
  | "unsupplied-input";

export interface PipelineProblem {
  line: string;
  node?: string;
  rule: PipelineRule;
  detail: string;
}

// The floor fills these from the run itself, so no line declares them.
const FLOOR_SUPPLIED = new Set(["context", "description", "prompt"]);

const PLACEHOLDER = /\{([a-z_][a-z0-9_]*)\}/g;

const bagItemSchema = z.object({ name: z.string().optional() }).loose();

const stationSchema = z
  .object({
    kind: z.string().optional(),
    agent_definition: z.string().optional(),
    outcomes: z.array(z.string()).default([]),
    needs: z.array(bagItemSchema).default([]),
    produces: z.array(bagItemSchema).default([]),
  })
  .loose();

// Only what a rule reads, with every optional part defaulted here rather than at each use.
const pipelineSchema = z
  .object({
    line: z
      .object({
        id: z.string(),
        args: z
          .record(
            z.string(),
            z.object({ subject: z.boolean().optional() }).loose(),
          )
          .default({}),
        nodes: z
          .array(
            z
              .object({ id: z.string(), station: z.string().optional() })
              .loose(),
          )
          .default([]),
        edges: z
          .array(
            z.object({ from: z.string(), on: z.string().optional() }).loose(),
          )
          .default([]),
      })
      .loose(),
    stations: z.record(z.string(), stationSchema).default({}),
  })
  .loose();

type Checked = z.infer<typeof pipelineSchema>;
type Station = z.infer<typeof stationSchema>;
type Node = Checked["line"]["nodes"][number];

export function pipelineProblems(
  yamlText: string,
  prompts: AgentPrompts,
): PipelineProblem[] {
  const read = pipelineSchema.safeParse(parse(yamlText));

  if (!read.success) {
    return [];
  }
  const checked = read.data;
  const { nodes } = checked.line;

  return [
    ...unkeyedLine(checked),
    ...ambiguousEdges(checked),
    ...nodes.flatMap((node) => nodeProblems(checked, node, prompts)),
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

  return [
    {
      line: checked.line.id,
      rule: "unkeyed-line",
      detail: unkeyedDetail(keys),
    },
  ];
}

function unkeyedDetail(keys: string[]): string {
  return keys.length === 0
    ? "no arg carries subject: true, so the floor cannot refuse a second run for the same subject"
    : `${keys.join(", ")} all carry subject: true, and a run has one subject`;
}

// A station picks its outgoing edge from its OWN outcome, so two on one outcome have no tie-break.
function ambiguousEdges(checked: Checked): PipelineProblem[] {
  const seen = new Map<string, number>();

  for (const edge of checked.line.edges) {
    const key = `${edge.from}\n${edge.on ?? ""}`;

    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return [...seen]
    .filter(([, count]) => count > 1)
    .map(([key]) => key.split("\n"))
    .map(([from, outcome]) =>
      problem(checked, from, "ambiguous-edge", ambiguousDetail(outcome)),
    );
}

function ambiguousDetail(outcome: string | undefined): string {
  return `two edges leave it on ${outcome}; a station reads its own outcome, never the verdict of the node that reached it`;
}

function nodeProblems(
  checked: Checked,
  node: Node,
  prompts: AgentPrompts,
): PipelineProblem[] {
  const station = node.station ? checked.stations[node.station] : undefined;

  if (!station) {
    return [];
  }

  return [
    ...unroutedOutcomes(checked, node, station),
    ...unsuppliedInputs(checked, node, station, prompts),
  ];
}

// An outcome no edge routes is a run that stops where nobody said it should.
function unroutedOutcomes(
  checked: Checked,
  node: Node,
  station: Station,
): PipelineProblem[] {
  const unrouted = unroutedOf(checked, node, station);

  return unrouted.length === 0
    ? []
    : [
        problem(
          checked,
          node.id,
          "outcome-without-edge",
          unroutedDetail(unrouted),
        ),
      ];
}

function unroutedOf(checked: Checked, node: Node, station: Station): string[] {
  const routed = outcomesLeaving(checked, node.id);

  return routed.has("always")
    ? []
    : station.outcomes.filter((outcome) => !routed.has(outcome));
}

function outcomesLeaving(checked: Checked, nodeId: string): Set<string> {
  const { edges } = checked.line;

  return new Set(
    edges.filter((edge) => edge.from === nodeId).map((edge) => edge.on ?? ""),
  );
}

function unroutedDetail(unrouted: string[]): string {
  const what = unrouted.length === 1 ? "that outcome" : "those outcomes";

  return `declares ${unrouted.join(", ")} and no edge leaves it on ${what}`;
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

function problem(
  checked: Checked,
  node: string | undefined,
  rule: PipelineRule,
  detail: string,
): PipelineProblem {
  return { line: checked.line.id, node, rule, detail };
}
