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
  "gate",
  "retrospective",
  "github_action",
  "detect",
  "comment-triage",
  "ingest",
  // Files the GitHub Issues + spec-tasks a decomposition calls for. A station, not
  // an agent: the judgement (which stories, which labels) already happened upstream,
  // and this only writes what the artifact says.
  "issues",
  // Stations whose worker is OUTSIDE the pod system — a PERSON. They dispatch
  // nothing and park the run until the page named by `route` reports an outcome,
  // over HTTP, on the same station contract a pod reports over stdout. The TYPE
  // names the form contract; `route` names where that form lives (FR6.40).
  ...HUMAN_STATION_TYPES,
]);

const EdgeCondition = z.enum([
  "success",
  "changes_requested",
  "failed",
  "always",
]);

// A field added to NodeSchema or AssemblyLineSchema changes definitionHash by
// default (definition-hash.ts hashes everything not in its IGNORED_KEYS
// denylist), which makes stored fork hashes refuse to resume across the change.
// That over-refusal is deliberate; add prose-only fields to IGNORED_KEYS.
const NodeSchema = z.object({
  // Node ids are embedded in the Agent CR NAME (`<id12>-<nodeId>`, DNS-1123) and
  // in a CR LABEL VALUE, so they must be DNS-label-safe: lowercase alnum + hyphen,
  // no leading/trailing hyphen, no underscore, and short enough to fit both. A
  // looser id (`retry_`, trailing `-`) would pass the loader and die at CR-create
  // with an opaque admission error — fail fast here instead.
  id: z
    .string()
    .regex(/^[a-z]([a-z0-9-]*[a-z0-9])?$/)
    .max(50),
  type: NodeType,
  prompt_ref: z.string().optional(),
  model: z.string().optional(),
  validator: z.string().optional(),
  condition_ref: z.string().optional(),
  job_ref: z.string().optional(),
  /** Required for a HUMAN station: the page its worker acts on. Relative — a page
   *  this platform serves; absolute — one it does not own, such as a GitHub PR.
   *  `{args.x}` placeholders resolve against the run's args at READ time, since a
   *  value like `pr_url` does not exist until a node has produced it. */
  route: z.string().optional(),
  /** Custom station (agent-definitions name) overriding the default `def-<type>`. */
  station_ref: z.string().optional(),
  /** Per-node run timeout; falls back to the referenced Station's deadline. */
  timeout_minutes: z.number().int().positive().optional(),
  /** Continue a previous run instead of starting a fresh conversation.
   *  `node` names the work continued (validated against this definition below);
   *  `key` identifies WHICH thread, so two features running the same definition
   *  concurrently never continue each other. */
  continues: z
    .object({
      node: z.string(),
      key: z.string(),
    })
    .optional(),
  description: z.string().optional(),
});

const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  on: EdgeCondition,
  iteration_max: z.number().int().positive().optional(),
});

const AssemblyLineSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.literal(1),
  entry: z.string(),
  exit: z.string(),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
});

export type AssemblyLineNode = z.infer<typeof NodeSchema>;
export type AssemblyLineEdge = z.infer<typeof EdgeSchema>;
export type AssemblyLine = z.infer<typeof AssemblyLineSchema>;
export type EdgeConditionValue = z.infer<typeof EdgeCondition>;

// The outcomes each node type can produce at runtime (`stationNodeOutcome`,
// specs/6-dark-factory/contracts/station-contract.md): every type yields
// `failed` on an infrastructure failure (CR phase Failed, station timeout) and
// `success` as the fallback; only agent output carries the LORE_NODE_RESULT /
// REVIEW_RESULT verdict lines that yield `changes_requested` — with ONE exception:
// `issues` is the first station that judges its input rather than merely acting on
// it (a label the repo does not have, a story with no tasks), so it can send the
// decomposition back. Listing it here is what forces every definition using the node
// to route that outcome, since selectEdge does not fall through.
const PRODUCIBLE_OUTCOMES: Record<
  z.infer<typeof NodeType>,
  readonly EdgeConditionValue[]
> = {
  agent: ["success", "changes_requested", "failed"],
  validate: ["success", "failed"],
  gate: ["success", "failed"],
  retrospective: ["success", "failed"],
  github_action: ["success", "failed"],
  detect: ["success", "failed"],
  "comment-triage": ["success", "failed"],
  ingest: ["success", "failed"],
  issues: ["success", "changes_requested", "failed"],
  // accept / merged, refine, and abandoned — a person can do all three.
  feature_review: ["success", "changes_requested", "failed"],
  pr_review: ["success", "changes_requested", "failed"],
};

/** Producible outcomes of `node` with no matching edge, under `selectEdge`
 *  semantics: an `always` edge covers every outcome. Empty for the exit node. */
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

/**
 * Parse and fully validate an assembly line definition. Throws
 * {@link AssemblyLineLoadError} on malformed YAML, schema violation,
 * dangling node references, unreachable nodes, terminal-only-on-exit
 * violations, producible outcomes with no matching edge, or back-edges
 * without `iteration_max`.
 */
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

/**
 * Load every `*.yaml` / `*.yml` file under `dir`. Returns a map keyed
 * by `assembly line.name`. Fail-fast on any invalid file or duplicate name.
 */
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

  // Reachability from entry (BFS).
  const reachable = new Set<string>([wf.entry]);
  const queue: string[] = [wf.entry];

  while (queue.length > 0) {
    const cur = queue.shift()!;

    for (const e of wf.edges) {
      if (e.from === cur && !reachable.has(e.to)) {
        reachable.add(e.to);
        queue.push(e.to);
      }
    }
  }

  for (const id of nodeIds) {
    enforceTrue(
      reachable.has(id),
      loadError,
      `node "${id}" is not reachable from entry`,
    );
  }

  // Every non-exit node has at least one outgoing edge.
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

  // A detect node without its job reference can't be dispatched — reject at load.
  for (const n of wf.nodes) {
    enforceTrue(
      n.type !== "detect" || n.job_ref,
      Error,
      `detect node "${n.id}" requires job_ref`,
    );
  }

  // A human station with no route leaves its worker with nowhere to go: the run
  // parks on it and nothing can tell anyone whose move it is. Reject at load,
  // exactly as a detect node with no job_ref is rejected.
  for (const n of wf.nodes) {
    enforceTrue(
      !isHumanStation(n.type) || n.route,
      Error,
      `human station "${n.id}" requires route`,
    );

    const invalid = n.route ? invalidRoutePlaceholders(n.route) : [];

    // A placeholder reaching outside `args` could only be filled by the engine
    // knowing what a feature is — the one thing it must never learn.
    enforceTrue(
      invalid.length === 0,
      Error,
      `node "${n.id}": route placeholder "${invalid[0]}" is not an {args.<name>} reference`,
    );
  }

  // A `continues` reference must name a real node and a resolvable thread key.
  // Both fail at LOAD because the runtime failure is invisible: an unresolvable
  // reference would silently start a fresh conversation, which looks exactly like a
  // continued one that happened to remember nothing.
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

  // Every outcome a node can produce must route somewhere — an uncovered
  // outcome would otherwise crash the walk at runtime (`nextTransition`'s
  // no-edge failure) instead of failing here at load.
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

  // Cycles must carry iteration_max on the back-edge (DFS coloring).
  detectCycles(wf, source);
}

/** The thread a `continues` reference belongs to: this run (`line`), this task across
 *  attempts (`task`), or whatever value the run carries under `args.<name>`. The
 *  args form keeps the engine domain-free — Lore keys planning threads by
 *  `args.feature_id` exactly as detect lines already carry `args.job_run_id`. */
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

  // Iterative DFS with explicit stack. Each frame holds the node id
  // and an index into its outgoing edge list — when we exhaust edges,
  // we pop and color the node BLACK. Symmetric with the BFS used for
  // reachability above, and won't blow the stack on deeply-nested
  // hand-authored YAML.
  for (const start of wf.nodes) {
    if (color.get(start.id) !== WHITE) {
      continue;
    }
    const stack: Array<{ id: string; edgeIndex: number }> = [
      { id: start.id, edgeIndex: 0 },
    ];

    color.set(start.id, GRAY);

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
        // The rule exists so two AGENTS cannot argue indefinitely. A back-edge with a
        // `wait` node at EITHER end is exempt: leaving one, the human has just
        // decided; entering one, the human decides before anything else runs. Either
        // way a person gates every pass, so the runaway this guards against cannot
        // happen. Keyed strictly on the endpoints' types — a cycle between two agents
        // is still bounded, so this cannot become a way to write an unbounded agent
        // loop.
        const humanGated =
          isHumanStation(typeOf.get(e.from)) ||
          isHumanStation(typeOf.get(e.to));

        if (!e.iteration_max && !humanGated) {
          throw new AssemblyLineLoadError(
            `back-edge ${e.from} → ${e.to} requires iteration_max`,
            source,
          );
        }
      } else if (c === WHITE) {
        color.set(e.to, GRAY);
        stack.push({ id: e.to, edgeIndex: 0 });
      }
    }
  }
}
