// Pure derivations for RunVisualizationPanel: no JSX, no hooks — just "given this state, what should the panel show".
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeRunState, initialRunState } from "@/lib/run-event-reducer";
import type { RunData } from "@/lib/graph-view-model";
import { isTerminalRunStatus } from "./run-stream-presenter";

/** Run data exists once the walk visited a node (persisted row or left-idle live stream); "Show possible outcomes" flips to definition view without disturbing it. */
export function participated(state: NodeRunState): boolean {
  return state.status !== "idle" || state.transcript.length > 0;
}

/** A run reports failed the moment any node did, and completed only once it is terminal with none — an unfinished run has no result yet. */
export function runResult(
  anyFailed: boolean,
  runStatus: string,
): RunData["result"] {
  if (anyFailed) {
    return "failed";
  }

  return isTerminalRunStatus(runStatus) ? "completed" : null;
}

/** The selected node's current run state, or null when nothing is selected — mirrors the object-index lookup Object[key] would give. */
export function pickSelectedState(
  nodeStates: Readonly<Record<string, NodeRunState>>,
  selectedNodeId: string | null,
): NodeRunState | null {
  return selectedNodeId === null ? null : nodeStates[selectedNodeId];
}

/** Which of the two reducer states (live vs. scrubbed-back-in-time) the panel currently shows. */
export function pickDisplayState(
  runIsLive: boolean,
  state: ReturnType<typeof initialRunState>,
  replayState: ReturnType<typeof initialRunState>,
) {
  return runIsLive ? state : replayState;
}

/** The scrubber only makes sense once a run is over and actually has history to scrub through. */
export function computeScrubberVisible(
  runStatus: string,
  historyEventCount: number,
): boolean {
  return isTerminalRunStatus(runStatus) && historyEventCount > 0;
}

/** True once the walk has visited something worth showing — either persisted rows or a live-but-idle stream. */
export function computeHasRunData(
  nodeCount: number,
  nodeStates: Readonly<Record<string, NodeRunState>>,
): boolean {
  return nodeCount > 0 || Object.values(nodeStates).some(participated);
}

/** "run" shows only the executed path; toggling to outcomes (or having nothing executed yet) falls back to "definition". */
export function computeGraphMode(
  hasRunData: boolean,
  showOutcomes: boolean,
): "run" | "definition" {
  return hasRunData && !showOutcomes ? "run" : "definition";
}

/** Mid-scrub only — the cursor sits strictly before the history's end, so the slider's right end stays byte-identical to Back to live. */
export function computeReplayActive(
  runIsLive: boolean,
  replayCursor: number | null,
  historyEventCount: number,
): boolean {
  return (
    !runIsLive && replayCursor !== null && replayCursor < historyEventCount
  );
}

/** Only wire onSeek through once the scrubber is actually visible — an invisible scrubber has nothing to seek. */
export function resolveOnSeek(
  scrubberVisible: boolean,
  onSeek: (id: string) => void,
): ((id: string) => void) | undefined {
  return scrubberVisible ? onSeek : undefined;
}

/** The graph's view of a live or finished run: which nodes ran, what each was told, and whether the run as a whole succeeded. */
export function buildRunData({
  nodes,
  nodeStates,
  latestRows,
  takenEdges,
  runStatus,
}: {
  nodes: readonly AssemblyRunNode[];
  nodeStates: Readonly<Record<string, NodeRunState>>;
  latestRows: Map<string, AssemblyRunNode>;
  takenEdges: RunData["taken"];
  runStatus: string;
}): RunData {
  const entries = Object.entries(nodeStates);
  // Verdict is the walk row's recorded outcome (must come from rows, not reducer state — replayed events never carry the verdict).
  const rows = [...latestRows.values()];
  // Mirrors the Floor's lineOutcomeFromVisits: any failed node outcome fails the run result, even on a `finished` terminal.
  const anyFailed = rows.some((n) => (n.outcome ?? "").includes("failed"));

  return {
    executed: new Set([
      ...nodes.map((n) => n.nodeId),
      ...entries.filter(([, s]) => participated(s)).map(([id]) => id),
    ]),
    verdicts: Object.fromEntries(rows.map((n) => [n.nodeId, n.outcome])),
    statuses: Object.fromEntries(entries.map(([id, s]) => [id, s.status])),
    taken: takenEdges,
    result: runResult(anyFailed, runStatus),
  };
}
