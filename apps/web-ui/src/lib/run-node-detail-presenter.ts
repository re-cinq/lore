// Assemble plain-language explanation + supporting facts for a clicked node; pure (transcript from reducer, walk facts from row).

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";
import type { NodeRunState } from "./run-event-reducer";
import { nodeRunVisual, type NodeStatusTone } from "./run-node-status";
import { humanStation } from "./human-station";
import { formatDuration } from "./assembly-run-presenter";

export interface NodeDetailInput {
  nodeId: string;
  state: NodeRunState | undefined;
  row: AssemblyRunNode | undefined;
  definition: AssemblyLineDefinition | null;
  reason: string | null;
}

export interface FailedStep {
  /** The tool that errored, or the event kind (e.g. `result`) when it carries no tool. */
  tool: string;
  detail: string;
}

export interface NodeDetail {
  tone: NodeStatusTone;
  statusLabel: string;
  why: string;
  /** Every errored step in order; empty when nothing errored. */
  failures: FailedStep[];
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
    event.filePaths.forEach((path) => files.add(path));
  }

  return [...files];
}

/** Last errored result line's summary; closest thing to a failure message in the stream. */
function failureSummary(state: NodeRunState | undefined): string | null {
  for (const event of [...(state?.transcript ?? [])].reverse()) {
    if (event.eventType === "result" && event.isError && event.summary) {
      return event.summary;
    }
  }

  return null;
}

/** Every errored step with message, in order; concrete causes (tool calls, verdicts) behind the one-line why. */
function erroredSteps(state: NodeRunState | undefined): FailedStep[] {
  const steps: FailedStep[] = [];

  for (const event of state?.transcript ?? []) {
    if (event.isError && event.summary) {
      steps.push({
        tool:
          event.toolName ??
          (event.eventType === "result" ? "agent" : event.eventType),
        detail: event.summary,
      });
    }
  }

  return steps;
}

interface NodeStanding {
  tone: NodeStatusTone;
  terminal: boolean;
  duration: string;
}

function whyText(
  input: NodeDetailInput,
  type: string | undefined,
  { tone, terminal, duration }: NodeStanding,
): string {
  const noun = type ? `the ${type} node` : "this step";

  if (tone === "running") {
    return `In progress — ${noun} is running.`;
  }

  // Parked human station: reader needs to know whose move it is (often their own).
  if (tone === "waiting") {
    return (
      humanStation(type)?.whyParked ??
      "Parked — waiting for you to review this round."
    );
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
  // Single lookup; every fact below reads this node, not its own find; verdict row is authoritative.
  const node = input.definition?.nodes.find((n) => n.id === input.nodeId);
  const visual = nodeRunVisual(
    input.row?.outcome ?? null,
    input.state?.status ?? "idle",
    node?.type,
  );
  const terminal = isTerminal(input.definition, input.nodeId);
  const durationSeconds = input.row?.durationSeconds ?? null;
  const running = visual.tone === "running";
  const statusLabel =
    visual.tone === "idle" && terminal ? "Terminal" : visual.label;

  return {
    tone: visual.tone,
    statusLabel,
    why: whyText(input, node?.type, {
      tone: visual.tone,
      terminal,
      duration: formatDuration(durationSeconds),
    }),
    // Only failed nodes list errored steps; succeeded nodes may carry retried tool calls (not the reason for success).
    failures: visual.tone === "err" ? erroredSteps(input.state) : [],
    files: uniqueFiles(input.state),
    eventCount: input.state?.transcript.length ?? 0,
    droppedCount: input.state?.droppedCount ?? 0,
    nodeType: node?.type ?? null,
    outcomeLabel: running ? "in progress" : (input.row?.outcome ?? "—"),
    durationLabel: running ? "running" : formatDuration(durationSeconds),
    iteration: input.row?.iteration ?? input.state?.iteration ?? 0,
    agentCrName: input.row?.agentCrName ?? null,
    commitSha: input.row?.commitSha ?? null,
    durationSeconds,
    startedAt: input.row?.startedAt ?? null,
  };
}
