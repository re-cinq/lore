// The "why" behind a single node: assembles the plain-language explanation and
// the supporting facts a reader wants when they click a node — did it run, what
// ran, why is it in this state. Pure; the transcript comes from the reducer and
// the walk facts from the row, so this stays unit-testable.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { NodeRunState } from "./run-event-reducer";
import { nodeRunVisual, type NodeStatusTone } from "./run-node-status";
import { formatDuration } from "./assembly-line-presenter";

export interface NodeDetailInput {
  nodeId: string;
  state: NodeRunState | undefined;
  row: AssemblyLineRunNode | undefined;
  definition: AssemblyLineDefinition | null;
  reason: string | null;
}

export interface NodeDetail {
  tone: NodeStatusTone;
  statusLabel: string;
  why: string;
  files: string[];
  eventCount: number;
  droppedCount: number;
  nodeType: string | null;
  /** Outcome for display: "in progress" while running, else the outcome or "—". */
  outcomeLabel: string;
  /** Duration for display: "running" while in flight, else the elapsed time or "—". */
  durationLabel: string;
  iteration: number;
  agentCrName: string | null;
  commitSha: string | null;
  durationSeconds: number | null;
  startedAt: string | null;
}

function isTerminal(
  definition: AssemblyLineDefinition | null,
  nodeId: string,
): boolean {
  return !(definition?.edges ?? []).some((edge) => edge.from === nodeId);
}

function uniqueFiles(state: NodeRunState | undefined): string[] {
  const files = new Set<string>();

  for (const event of state?.transcript ?? []) {
    for (const path of event.filePaths) {
      files.add(path);
    }
  }

  return [...files];
}

/** The last errored `result` line's summary — the closest thing to a failure
 *  message the stream carries. */
function failureSummary(state: NodeRunState | undefined): string | null {
  for (const event of [...(state?.transcript ?? [])].reverse()) {
    if (event.eventType === "result" && event.isError && event.summary) {
      return event.summary;
    }
  }

  return null;
}

function whyText(
  input: NodeDetailInput,
  tone: NodeStatusTone,
  terminal: boolean,
  duration: string,
): string {
  const type = input.definition?.nodes.find(
    (node) => node.id === input.nodeId,
  )?.type;
  const noun = type ? `the ${type} node` : "this step";

  if (tone === "running") {
    return `In progress — ${noun} is running.`;
  }

  if (tone === "ok") {
    return `Ran ${noun} and emitted ${input.row?.outcome ?? "success"} in ${duration}.${
      terminal ? " Final step of the run." : ""
    }`;
  }

  if (tone === "warn") {
    return `Ran ${noun} and requested changes in ${duration}.`;
  }

  if (tone === "err") {
    return `Failed: ${failureSummary(input.state) ?? input.reason ?? `${noun} did not complete`}.`;
  }

  if (terminal) {
    return "Terminal marker — the run ends here.";
  }

  return "Not reached — the run finished along another branch before it ran.";
}

export function describeNode(input: NodeDetailInput): NodeDetail {
  // The verdict on the walk row is authoritative; the execution status only fills
  // in while a node is still in flight (no recorded outcome yet).
  const visual = nodeRunVisual(
    input.row?.outcome ?? null,
    input.state?.status ?? "idle",
  );
  const terminal = isTerminal(input.definition, input.nodeId);
  const durationSeconds = input.row?.durationSeconds ?? null;
  const running = visual.tone === "running";
  const statusLabel =
    visual.tone === "idle" && terminal ? "Terminal" : visual.label;

  return {
    tone: visual.tone,
    statusLabel,
    why: whyText(input, visual.tone, terminal, formatDuration(durationSeconds)),
    files: uniqueFiles(input.state),
    eventCount: input.state?.transcript.length ?? 0,
    droppedCount: input.state?.droppedCount ?? 0,
    nodeType:
      input.definition?.nodes.find((node) => node.id === input.nodeId)?.type ??
      null,
    outcomeLabel: running ? "in progress" : (input.row?.outcome ?? "—"),
    durationLabel: running ? "running" : formatDuration(durationSeconds),
    iteration: input.row?.iteration ?? input.state?.iteration ?? 0,
    agentCrName: input.row?.agentCrName ?? null,
    commitSha: input.row?.commitSha ?? null,
    durationSeconds,
    startedAt: input.row?.startedAt ?? null,
  };
}
