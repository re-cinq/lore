// What every pipeline rule reads, and nothing else: specs/7-feature-planning FR-20.

import { parse } from "yaml";
import { z } from "zod";

export type PipelineRule =
  | "ambiguous-edge"
  | "dead-end"
  | "undeclared-bag"
  | "outcome-without-edge"
  | "undeclared-outcome"
  | "unkeyed-line"
  | "unreachable"
  | "unsupplied-input";

export interface PipelineProblem {
  line: string;
  node?: string;
  rule: PipelineRule;
  detail: string;
}

const bagItemSchema = z.object({ name: z.string().optional() }).loose();

const stationSchema = z
  .object({
    kind: z.string().optional(),
    agent_definition: z.string().optional(),
    outcomes: z.array(z.string()).default([]),
    needs: z.array(bagItemSchema).optional(),
    produces: z.array(bagItemSchema).optional(),
  })
  .loose();

// Every optional part is defaulted here rather than at each use.
const pipelineSchema = z
  .object({
    line: z
      .object({
        id: z.string(),
        entry: z.string().default(""),
        exit: z.string().default(""),
        args: z
          .record(
            z.string(),
            z.object({ subject: z.boolean().optional() }).loose(),
          )
          .default({}),
        nodes: z
          .array(
            z
              .object({
                id: z.string(),
                station: z.string().optional(),
                // A node a person starts by hand needs no edge into it.
                start: z.string().optional(),
              })
              .loose(),
          )
          .default([]),
        edges: z
          .array(
            z
              .object({
                from: z.string(),
                to: z.string().default(""),
                on: z.string().optional(),
              })
              .loose(),
          )
          .default([]),
      })
      .loose(),
    stations: z.record(z.string(), stationSchema).default({}),
  })
  .loose();

export type Checked = z.infer<typeof pipelineSchema>;
export type Station = z.infer<typeof stationSchema>;
export type Node = Checked["line"]["nodes"][number];

/** The pipeline as the rules read it, or none when the text is not one. */
export function readPipeline(yamlText: string): Checked | null {
  const read = pipelineSchema.safeParse(parse(yamlText));

  return read.success ? read.data : null;
}

export function problem(
  checked: Checked,
  node: string | undefined,
  rule: PipelineRule,
  detail: string,
): PipelineProblem {
  return { line: checked.line.id, node, rule, detail };
}

export function stationOf(checked: Checked, node: Node): Station | undefined {
  return node.station ? checked.stations[node.station] : undefined;
}

export function outcomesLeaving(checked: Checked, nodeId: string): Set<string> {
  const { edges } = checked.line;

  return new Set(
    edges.filter((edge) => edge.from === nodeId).map((edge) => edge.on ?? ""),
  );
}
