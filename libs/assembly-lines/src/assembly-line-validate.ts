// Structural validation for a parsed AssemblyLine: entry/exit, edge endpoints, reachability, terminal nodes, parameterised-node refs, human-station routes, `continues` references, outcome coverage, and bounded back-edges. Split out of loader.ts (schema + parsing stay there) to keep that file under `max-lines`.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { invalidRoutePlaceholders, isHumanStation } from "./human-station.js";
import {
  AssemblyLineLoadError,
  uncoveredOutcomes,
  PARAMETERISED_NODE_TYPES,
  type AssemblyLine,
  type AssemblyLineEdge,
} from "./loader.js";

type LoadErrorFactory = (message: string) => AssemblyLineLoadError;

function validateEntryAndExit(
  wf: AssemblyLine,
  nodeIds: Set<string>,
  loadError: LoadErrorFactory,
): void {
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
}

function validateEdgeEndpoints(
  wf: AssemblyLine,
  nodeIds: Set<string>,
  loadError: LoadErrorFactory,
): void {
  for (const e of wf.edges) {
    enforceTrue(
      nodeIds.has(e.from),
      loadError,
      `edge from unknown node "${e.from}"`,
    );
    enforceTrue(nodeIds.has(e.to), loadError, `edge to unknown node "${e.to}"`);
  }
}

function enqueueUnreachedSuccessors(
  wf: AssemblyLine,
  cur: string,
  reachable: Set<string>,
  queue: string[],
): void {
  for (const e of wf.edges) {
    if (e.from === cur && !reachable.has(e.to)) {
      reachable.add(e.to);
      queue.push(e.to);
    }
  }
}

// Reachability from entry (BFS).
function reachableNodeIds(wf: AssemblyLine): Set<string> {
  const reachable = new Set<string>([wf.entry]);
  const queue: string[] = [wf.entry];

  while (queue.length > 0) {
    enqueueUnreachedSuccessors(wf, queue.shift()!, reachable, queue);
  }

  return reachable;
}

function validateReachability(
  wf: AssemblyLine,
  nodeIds: Set<string>,
  loadError: LoadErrorFactory,
): void {
  const reachable = reachableNodeIds(wf);

  for (const id of nodeIds) {
    enforceTrue(
      reachable.has(id),
      loadError,
      `node "${id}" is not reachable from entry`,
    );
  }
}

// Every non-exit node has at least one outgoing edge.
function validateTerminalNodes(
  wf: AssemblyLine,
  loadError: LoadErrorFactory,
): void {
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

// Parameterised node types need `job_ref` to have anything to dispatch; reject at load rather than at the pod, where the line is already half-walked.
function validateParameterisedNodes(wf: AssemblyLine): void {
  for (const n of wf.nodes) {
    enforceTrue(
      !PARAMETERISED_NODE_TYPES.has(n.type) || n.job_ref,
      Error,
      `${n.type} node "${n.id}" requires job_ref`,
    );
  }
}

// A human station with no route leaves its worker with nowhere to go, and a placeholder reaching outside `args` could only be filled by the engine knowing what a feature is — the one thing it must never learn.
function validateHumanStations(wf: AssemblyLine): void {
  for (const n of wf.nodes) {
    enforceTrue(
      !isHumanStation(n.type) || n.route,
      Error,
      `human station "${n.id}" requires route`,
    );

    const invalid = n.route ? invalidRoutePlaceholders(n.route) : [];

    enforceTrue(
      invalid.length === 0,
      Error,
      `node "${n.id}": route placeholder "${invalid[0]}" is not an {args.<name>} reference`,
    );
  }
}

// The thread a `continues` reference belongs to: this run (`line`), this task across attempts (`task`), or `args.<name>` — the args form keeps the engine domain-free (e.g. planning threads key on args.feature_id).
export function isThreadKey(key: string): boolean {
  return (
    key === "line" || key === "task" || /^args\.[a-z][a-z0-9_]*$/.test(key)
  );
}

// A `continues` reference must name a real node and a resolvable thread key — fail at LOAD, since an unresolvable reference would otherwise silently start a fresh conversation indistinguishable from one that remembers nothing.
function validateContinuesReferences(
  wf: AssemblyLine,
  nodeIds: Set<string>,
  loadError: LoadErrorFactory,
): void {
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

// Every outcome a node can produce must route somewhere, or it crashes the walk at runtime (getNextTransition's no-edge failure) instead of failing here at load.
function validateOutcomesCovered(
  wf: AssemblyLine,
  loadError: LoadErrorFactory,
): void {
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

export function validateAssemblyLine(wf: AssemblyLine, source: string): void {
  const nodeIds = new Set(wf.nodes.map((n) => n.id));
  const loadError = (message: string): AssemblyLineLoadError =>
    new AssemblyLineLoadError(message, source);

  validateEntryAndExit(wf, nodeIds, loadError);
  validateEdgeEndpoints(wf, nodeIds, loadError);
  validateReachability(wf, nodeIds, loadError);
  validateTerminalNodes(wf, loadError);
  validateParameterisedNodes(wf);
  validateHumanStations(wf);
  validateContinuesReferences(wf, nodeIds, loadError);
  validateOutcomesCovered(wf, loadError);
  // Cycles must carry iteration_max on the back-edge (DFS coloring).
  detectCycles(wf, source);
}
