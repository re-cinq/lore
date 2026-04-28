import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

const NodeType = z.enum(["agent", "validate", "gate", "retrospective"]);
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
  description: z.string().optional(),
});

const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  on: EdgeCondition,
  iteration_max: z.number().int().positive().optional(),
});

const WorkflowSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.literal(1),
  entry: z.string(),
  exit: z.string(),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
});

export type WorkflowNode = z.infer<typeof NodeSchema>;
export type WorkflowEdge = z.infer<typeof EdgeSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type EdgeConditionValue = z.infer<typeof EdgeCondition>;

export class WorkflowLoadError extends Error {
  constructor(
    message: string,
    public readonly source?: string,
  ) {
    const where = source ? ` [${source}]` : "";
    super(`${message}${where}`);
    this.name = "WorkflowLoadError";
  }
}

/**
 * Parse and fully validate a workflow definition. Throws
 * {@link WorkflowLoadError} on malformed YAML, schema violation,
 * dangling node references, unreachable nodes, terminal-only-on-exit
 * violations, or back-edges without `iteration_max`.
 */
export function parseWorkflow(yamlSrc: string, source = "<inline>"): Workflow {
  let raw: unknown;
  try {
    raw = parseYaml(yamlSrc);
  } catch (err) {
    throw new WorkflowLoadError(
      `Invalid YAML: ${(err as Error).message}`,
      source,
    );
  }

  const parsed = WorkflowSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new WorkflowLoadError(`Schema violation: ${issues}`, source);
  }

  const wf = parsed.data;
  validateGraph(wf, source);
  return wf;
}

export async function loadWorkflowFile(filepath: string): Promise<Workflow> {
  const yamlSrc = await fs.readFile(filepath, "utf-8");
  return parseWorkflow(yamlSrc, filepath);
}

/**
 * Load every `*.yaml` / `*.yml` file under `dir`. Returns a map keyed
 * by `workflow.name`. Fail-fast on any invalid file or duplicate name.
 */
export async function loadWorkflowDir(
  dir: string,
): Promise<Map<string, Workflow>> {
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
  const out = new Map<string, Workflow>();
  for (const f of yamls) {
    const wf = await loadWorkflowFile(path.join(dir, f));
    if (out.has(wf.name)) {
      throw new WorkflowLoadError(
        `Duplicate workflow name "${wf.name}"`,
        path.join(dir, f),
      );
    }
    out.set(wf.name, wf);
  }
  return out;
}

function validateGraph(wf: Workflow, source: string): void {
  const nodeIds = new Set(wf.nodes.map((n) => n.id));

  if (!nodeIds.has(wf.entry)) {
    throw new WorkflowLoadError(
      `entry "${wf.entry}" is not a defined node id`,
      source,
    );
  }
  if (!nodeIds.has(wf.exit)) {
    throw new WorkflowLoadError(
      `exit "${wf.exit}" is not a defined node id`,
      source,
    );
  }

  for (const e of wf.edges) {
    if (!nodeIds.has(e.from)) {
      throw new WorkflowLoadError(
        `edge from unknown node "${e.from}"`,
        source,
      );
    }
    if (!nodeIds.has(e.to)) {
      throw new WorkflowLoadError(
        `edge to unknown node "${e.to}"`,
        source,
      );
    }
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
    if (!reachable.has(id)) {
      throw new WorkflowLoadError(
        `node "${id}" is not reachable from entry`,
        source,
      );
    }
  }

  // Every non-exit node has at least one outgoing edge.
  for (const n of wf.nodes) {
    if (n.id === wf.exit) continue;
    const hasOut = wf.edges.some((e) => e.from === n.id);
    if (!hasOut) {
      throw new WorkflowLoadError(
        `node "${n.id}" has no outgoing edges (only "${wf.exit}" may be terminal)`,
        source,
      );
    }
  }

  // Cycles must carry iteration_max on the back-edge (DFS coloring).
  detectCycles(wf, source);
}

function detectCycles(wf: Workflow, source: string): void {
  const adj = new Map<string, WorkflowEdge[]>();
  for (const n of wf.nodes) adj.set(n.id, []);
  for (const e of wf.edges) adj.get(e.from)!.push(e);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of wf.nodes) color.set(n.id, WHITE);

  function visit(id: string): void {
    color.set(id, GRAY);
    for (const e of adj.get(id) ?? []) {
      const c = color.get(e.to);
      if (c === GRAY) {
        if (!e.iteration_max) {
          throw new WorkflowLoadError(
            `back-edge ${e.from} → ${e.to} requires iteration_max`,
            source,
          );
        }
      } else if (c === WHITE) {
        visit(e.to);
      }
    }
    color.set(id, BLACK);
  }

  for (const n of wf.nodes) {
    if (color.get(n.id) === WHITE) visit(n.id);
  }
}
