import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  HUMAN_STATION_TYPES,
  invalidRoutePlaceholders,
  isHumanStation,
} from "./human-station.js";

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

const AssemblyLineSchema = z.strictObject({
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

// Parses and fully validates an assembly line definition; throws AssemblyLineLoadError on malformed YAML, schema violation, dangling/unreachable nodes, non-exit terminal nodes, uncovered outcomes, or unbounded back-edges.
const PARAMETERISED_NODE_TYPES = new Set([
  "detect",
  "merge_step",
  "escalation_step",
]);

export function parseAssemblyLine(
  yamlSrc: string,
  source = "<inline>",
): AssemblyLine {
  let raw: unknown;

  try {
    raw = parseYaml(yamlSrc);
  } catch (err) {
    throw new AssemblyLineLoadError(
      `Invalid YAML: ${(err as Error).message}`,
      source,
    );
  }

  const parsed = AssemblyLineSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");

    throw new AssemblyLineLoadError(`Schema violation: ${issues}`, source);
  }

  const wf = parsed.data;

  validateAssemblyLine(wf, source);

  return wf;
}

export async function loadAssemblyLineFile(
  filepath: string,
): Promise<AssemblyLine> {
  const yamlSrc = await fs.readFile(filepath, "utf-8");

  return parseAssemblyLine(yamlSrc, filepath);
}

// Loads every `*.yaml`/`*.yml` file under `dir` into a map keyed by assembly-line name; fail-fast on any invalid file or duplicate name.
export async function loadAssemblyLineDir(
  dir: string,
): Promise<Map<string, AssemblyLine>> {
  let entries: string[];

  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw err;
  }
  const yamls = entries.filter(
    (e) => e.endsWith(".yaml") || e.endsWith(".yml"),
  );
  const out = new Map<string, AssemblyLine>();

  for (const f of yamls) {
    const wf = await loadAssemblyLineFile(path.join(dir, f));

    enforceTrue(
      !out.has(wf.name),
      (message) => new AssemblyLineLoadError(message, path.join(dir, f)),
      `Duplicate assemblyLine name "${wf.name}"`,
    );
    out.set(wf.name, wf);
  }

  return out;
}

function validateAssemblyLine(wf: AssemblyLine, source: string): void {
  const nodeIds = new Set(wf.nodes.map((n) => n.id));

  const loadError = (message: string): AssemblyLineLoadError =>
    new AssemblyLineLoadError(message, source);

  enforceTrue(
    nodeIds.has(wf.entry),
    loadError,
    `entry "${wf.entry}" is not a defined node id`,
  );
  enforceTrue(
    nodeIds.has(wf.exit),
    loadError,
    `exit "${wf.exit}" is not a defined node id`,
  );

  for (const e of wf.edges) {
    enforceTrue(
      nodeIds.has(e.from),
      loadError,
      `edge from unknown node "${e.from}"`,
    );
    enforceTrue(nodeIds.has(e.to), loadError, `edge to unknown node "${e.to}"`);
  }

  checkReachability(wf, nodeIds, loadError);
  checkOutgoingEdges(wf, loadError);
  checkNodeRequirements(wf);
  checkContinuesReferences(wf, nodeIds, loadError);
  checkOutcomeCoverage(wf, loadError);

  // Cycles must carry iteration_max on the back-edge (DFS coloring).
  detectCycles(wf, source);
}

type LoadError = (message: string) => AssemblyLineLoadError;

/** BFS from entry: a node no edge can reach would never run, and a YAML that declares one is a mistake, not a feature. */
function checkReachability(
  wf: AssemblyLine,
  nodeIds: Set<string>,
  loadError: LoadError,
): void {
  const reachable = new Set<string>([wf.entry]);
  const queue: string[] = [wf.entry];
  const discoverSuccessorsOf = (cur: string): void => {
    for (const e of wf.edges) {
      if (e.from === cur && !reachable.has(e.to)) {
        reachable.add(e.to);
        queue.push(e.to);
      }
    }
  };

  while (queue.length > 0) {
    discoverSuccessorsOf(queue.shift()!);
  }

  for (const id of nodeIds) {
    enforceTrue(
      reachable.has(id),
      loadError,
      `node "${id}" is not reachable from entry`,
    );
  }
}

/** Only the exit may be terminal; any other node without an outgoing edge strands the walk. */
function checkOutgoingEdges(wf: AssemblyLine, loadError: LoadError): void {
  for (const n of wf.nodes) {
    if (n.id === wf.exit) {
      continue;
    }
    const hasOut = wf.edges.some((e) => e.from === n.id);

    enforceTrue(
      hasOut,
      loadError,
      `node "${n.id}" has no outgoing edges (only "${wf.exit}" may be terminal)`,
    );
  }
}

function checkNodeRequirements(wf: AssemblyLine): void {
  // Parameterised node types need `job_ref` to have anything to dispatch; reject at load rather than at the pod, where the line is already half-walked.
  for (const n of wf.nodes) {
    enforceTrue(
      !PARAMETERISED_NODE_TYPES.has(n.type) || n.job_ref,
      Error,
      `${n.type} node "${n.id}" requires job_ref`,
    );
  }

  // A human station with no route leaves its worker with nowhere to go — reject at load, like a detect node with no job_ref.
  for (const n of wf.nodes) {
    enforceTrue(
      !isHumanStation(n.type) || n.route,
      Error,
      `human station "${n.id}" requires route`,
    );

    const invalid = n.route ? invalidRoutePlaceholders(n.route) : [];

    // A placeholder reaching outside `args` could only be filled by the engine knowing what a feature is — the one thing it must never learn.
    enforceTrue(
      invalid.length === 0,
      Error,
      `node "${n.id}": route placeholder "${invalid[0]}" is not an {args.<name>} reference`,
    );
  }
}

function checkContinuesReferences(
  wf: AssemblyLine,
  nodeIds: Set<string>,
  loadError: LoadError,
): void {
  // A `continues` reference must name a real node and a resolvable thread key — fail at LOAD, since an unresolvable reference would otherwise silently start a fresh conversation indistinguishable from one that remembers nothing.
  for (const n of wf.nodes) {
    if (!n.continues) {
      continue;
    }

    enforceTrue(
      nodeIds.has(n.continues.node),
      loadError,
      `node "${n.id}" in assembly line "${wf.name}" continues unknown node "${n.continues.node}"`,
    );
    enforceTrue(
      isThreadKey(n.continues.key),
      loadError,
      `node "${n.id}" in assembly line "${wf.name}" has invalid continues.key "${n.continues.key}" ` +
        `(expected "line", "task" or "args.<name>")`,
    );
  }
}

function checkOutcomeCoverage(wf: AssemblyLine, loadError: LoadError): void {
  // Every outcome a node can produce must route somewhere, or it crashes the walk at runtime (getNextTransition's no-edge failure) instead of failing here at load.
  for (const n of wf.nodes) {
    const missing = uncoveredOutcomes(wf, n);

    enforceTrue(
      missing.length === 0,
      loadError,
      `node "${n.id}" in assembly line "${wf.name}" has no edge for producible outcome(s) ${missing
        .map((o) => `"${o}"`)
        .join(", ")}`,
    );
  }
}

// The thread a `continues` reference belongs to: this run (`line`), this task across attempts (`task`), or `args.<name>` — the args form keeps the engine domain-free (e.g. planning threads key on args.feature_id).
export function isThreadKey(key: string): boolean {
  return (
    key === "line" || key === "task" || /^args\.[a-z][a-z0-9_]*$/.test(key)
  );
}

function detectCycles(wf: AssemblyLine, source: string): void {
  const adj = new Map<string, AssemblyLineEdge[]>();

  for (const n of wf.nodes) {
    adj.set(n.id, []);
  }

  for (const e of wf.edges) {
    adj.get(e.from)!.push(e);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  const typeOf = new Map(wf.nodes.map((n) => [n.id, n.type]));

  for (const n of wf.nodes) {
    color.set(n.id, WHITE);
  }

  // Exists so two AGENTS cannot argue indefinitely; a back-edge with a human station at EITHER end is exempt since a person gates every pass — a cycle between two agents is still bounded.
  const assertBackEdgeBounded = (e: AssemblyLineEdge): void => {
    const humanGated =
      isHumanStation(typeOf.get(e.from)) || isHumanStation(typeOf.get(e.to));

    if (!e.iteration_max && !humanGated) {
      throw new AssemblyLineLoadError(
        `back-edge ${e.from} → ${e.to} requires iteration_max`,
        source,
      );
    }
  };

  // Iterative DFS with an explicit stack (symmetric with the BFS above) so deeply-nested hand-authored YAML can't blow the call stack.
  const walkDfsFrom = (startId: string): void => {
    const stack: Array<{ id: string; edgeIndex: number }> = [
      { id: startId, edgeIndex: 0 },
    ];

    color.set(startId, GRAY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edges = adj.get(frame.id) ?? [];

      if (frame.edgeIndex >= edges.length) {
        color.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const e = edges[frame.edgeIndex++];
      const c = color.get(e.to);

      if (c === GRAY) {
        assertBackEdgeBounded(e);
        continue;
      }

      if (c === WHITE) {
        color.set(e.to, GRAY);
        stack.push({ id: e.to, edgeIndex: 0 });
      }
    }
  };

  for (const start of wf.nodes) {
    if (color.get(start.id) !== WHITE) {
      continue;
    }
    walkDfsFrom(start.id);
  }
}
