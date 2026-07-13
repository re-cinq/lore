import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

const NodeType = z.enum([
  "agent",
  "validate",
  "gate",
  "retrospective",
  "github_action",
  "detect",
]);
const EdgeCondition = z.enum([
  "success",
  "changes_requested",
  "failed",
  "always",
]);

const NodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  type: NodeType,
  prompt_ref: z.string().optional(),
  model: z.string().optional(),
  validator: z.string().optional(),
  condition_ref: z.string().optional(),
  job_ref: z.string().optional(),
  /** Custom station (agent-definitions name) overriding the default `def-<type>`. */
  station_ref: z.string().optional(),
  /** Per-node run timeout; falls back to the referenced Station's deadline. */
  timeout_minutes: z.number().int().positive().optional(),
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
 * violations, or back-edges without `iteration_max`.
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
      new AssemblyLineLoadError(
        `Duplicate assemblyLine name "${wf.name}"`,
        path.join(dir, f),
      ),
    );
    out.set(wf.name, wf);
  }
  return out;
}

function validateAssemblyLine(wf: AssemblyLine, source: string): void {
  const nodeIds = new Set(wf.nodes.map((n) => n.id));

  enforceTrue(
    nodeIds.has(wf.entry),
    new AssemblyLineLoadError(
      `entry "${wf.entry}" is not a defined node id`,
      source,
    ),
  );
  enforceTrue(
    nodeIds.has(wf.exit),
    new AssemblyLineLoadError(
      `exit "${wf.exit}" is not a defined node id`,
      source,
    ),
  );

  for (const e of wf.edges) {
    enforceTrue(
      nodeIds.has(e.from),
      new AssemblyLineLoadError(`edge from unknown node "${e.from}"`, source),
    );
    enforceTrue(
      nodeIds.has(e.to),
      new AssemblyLineLoadError(`edge to unknown node "${e.to}"`, source),
    );
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
      new AssemblyLineLoadError(
        `node "${id}" is not reachable from entry`,
        source,
      ),
    );
  }

  // Every non-exit node has at least one outgoing edge.
  for (const n of wf.nodes) {
    if (n.id === wf.exit) continue;
    const hasOut = wf.edges.some((e) => e.from === n.id);
    enforceTrue(
      hasOut,
      new AssemblyLineLoadError(
        `node "${n.id}" has no outgoing edges (only "${wf.exit}" may be terminal)`,
        source,
      ),
    );
  }

  // A detect node without its job reference can't be dispatched — reject at load.
  for (const n of wf.nodes) {
    enforceTrue(
      n.type !== "detect" || n.job_ref,
      `detect node "${n.id}" requires job_ref`,
    );
  }

  // Cycles must carry iteration_max on the back-edge (DFS coloring).
  detectCycles(wf, source);
}

function detectCycles(wf: AssemblyLine, source: string): void {
  const adj = new Map<string, AssemblyLineEdge[]>();
  for (const n of wf.nodes) adj.set(n.id, []);
  for (const e of wf.edges) adj.get(e.from)!.push(e);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of wf.nodes) color.set(n.id, WHITE);

  // Iterative DFS with explicit stack. Each frame holds the node id
  // and an index into its outgoing edge list — when we exhaust edges,
  // we pop and color the node BLACK. Symmetric with the BFS used for
  // reachability above, and won't blow the stack on deeply-nested
  // hand-authored YAML.
  for (const start of wf.nodes) {
    if (color.get(start.id) !== WHITE) continue;
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
        if (!e.iteration_max) {
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
