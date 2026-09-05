// Zod schema + node/edge types shared by loader.ts (parsing) and assembly-line-validate.ts (structural checks) — split out so neither imports back from the other.

import { z } from "zod";
import { HUMAN_STATION_TYPES } from "./human-station.js";

const NodeType = z.enum([
  "agent",
  "validate",
  "retrospective",
  "detect",
  "comment-triage",
  "ingest",
  // Files the GitHub Issues + spec-tasks a decomposition calls for — a station, not an agent, since the judgement already happened upstream.
  "issues",
  // One step of the merge line, parameterised by `job_ref` (like `detect`) rather than split into nine node types.
  "merge_step",
  "escalation_step",
  // Stations worked by a PERSON: dispatch nothing, park the run until `route` reports an outcome over HTTP on the same contract a pod reports over stdout (FR6.40).
  ...HUMAN_STATION_TYPES,
]);

const EdgeCondition = z.enum([
  "success",
  "changes_requested",
  "failed",
  "always",
]);

// A field added to NodeSchema/AssemblyLineSchema changes definitionHash by default (denylist in IGNORED_KEYS), refusing stored fork hashes across the change — deliberate; add prose-only fields to IGNORED_KEYS.
const NodeSchema = z.strictObject({
  // Node ids ride the Agent CR NAME (`<id12>-<nodeId>`, DNS-1123) and a CR LABEL VALUE, so must be DNS-label-safe (lowercase alnum+hyphen, no leading/trailing hyphen/underscore) — fail fast here rather than at CR-create's opaque admission error.
  id: z
    .string()
    .regex(/^[a-z]([a-z0-9-]*[a-z0-9])?$/)
    .max(50),
  type: NodeType,
  prompt_ref: z.string().optional(),
  model: z.string().optional(),
  condition_ref: z.string().optional(),
  job_ref: z.string().optional(),
  // Required for a HUMAN station: the page its worker acts on (relative = served by this platform, absolute = external e.g. a GitHub PR); {args.x} placeholders resolve against the run's args at READ time since e.g. pr_url doesn't exist until produced.
  route: z.string().optional(),
  // Custom station (agent-definitions name) overriding the default `def-<type>`.
  station_ref: z.string().optional(),
  // Per-node run timeout; falls back to the referenced Station's deadline.
  timeout_minutes: z.number().int().positive().optional(),
  // Capability tags a claiming cluster-agent must carry (specs/running-stations-in-any-k8s-cluster FR2); absent inherits repo settings at ENQUEUE time, never baked into definitionHash.
  required_tags: z.array(z.string()).optional(),
  // Continue a previous run instead of a fresh conversation: `node` names the continued work, `key` identifies WHICH thread so concurrent runs of the same definition never cross.
  continues: z
    .object({
      node: z.string(),
      key: z.string(),
    })
    .optional(),
  description: z.string().optional(),
  // STRICT: a mistyped key (`timeoutMinutes:`, `prompt-ref:`) used to be silently discarded; now a named, sourced load failure. Strictness adds no field, so it doesn't move definitionHash.
});

const EdgeSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  on: EdgeCondition,
  iteration_max: z.number().int().positive().optional(),
  // STRICT for the same reason, one worse case: a dropped `iterationMax` leaves a back-edge unbounded — exactly what the cycle check exists to refuse.
});

export const AssemblyLineSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  version: z.literal(1),
  entry: z.string(),
  exit: z.string(),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
});

// Every node type a blueprint may name; exported so the station registry binds to it (previously parallel lists with no compile-time link let a type reach a pod and die with `unknown station type`).
export const NODE_TYPES = NodeType.options;
export type NodeTypeValue = z.infer<typeof NodeType>;

export type AssemblyLineNode = z.infer<typeof NodeSchema>;
export type AssemblyLineEdge = z.infer<typeof EdgeSchema>;
export type AssemblyLine = z.infer<typeof AssemblyLineSchema>;
export type EdgeConditionValue = z.infer<typeof EdgeCondition>;

// Outcomes each node type can produce at runtime (`stationNodeOutcome`, specs/6-dark-factory/contracts/station-contract.md): all yield `failed`/`success`; only agent output yields `changes_requested` via LORE_NODE_RESULT/REVIEW_RESULT, except `issues`, which judges its input and can also send the decomposition back — listing it here forces every definition to route that outcome (selectEdge does not fall through).
const PRODUCIBLE_OUTCOMES: Record<
  z.infer<typeof NodeType>,
  readonly EdgeConditionValue[]
> = {
  agent: ["success", "changes_requested", "failed"],
  validate: ["success", "failed"],
  retrospective: ["success", "failed"],
  detect: ["success", "failed"],
  "comment-triage": ["success", "failed"],
  ingest: ["success", "failed"],
  issues: ["success", "changes_requested", "failed"],
  merge_step: ["success", "failed"],
  escalation_step: ["success", "failed"],
  // accept / merged, refine, and abandoned — a person can do all three.
  feature_review: ["success", "changes_requested", "failed"],
  pr_review: ["success", "changes_requested", "failed"],
};

// Producible outcomes of `node` with no matching edge under `selectEdge` semantics (an `always` edge covers every outcome); empty for the exit node.
export function uncoveredOutcomes(
  wf: AssemblyLine,
  node: AssemblyLineNode,
): EdgeConditionValue[] {
  if (node.id === wf.exit) {
    return [];
  }
  const covered = new Set(
    wf.edges.filter((e) => e.from === node.id).map((e) => e.on),
  );

  if (covered.has("always")) {
    return [];
  }

  return PRODUCIBLE_OUTCOMES[node.type].filter((o) => !covered.has(o));
}

export class AssemblyLineLoadError extends Error {
  constructor(
    message: string,
    public readonly source?: string,
  ) {
    const where = source ? ` [${source}]` : "";

    super(`${message}${where}`);
    this.name = "AssemblyLineLoadError";
  }
}

export const PARAMETERISED_NODE_TYPES = new Set([
  "detect",
  "merge_step",
  "escalation_step",
]);
