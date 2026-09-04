// Assemble plain-language explanation + supporting facts for a clicked node; pure (transcript from reducer, walk facts from row).

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";
import type { NodeRunState } from "./run-event-reducer";
import type { RunStreamEvent } from "./run-stream-types";
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

function isFailedResult(event: RunStreamEvent): boolean {
  return (
    event.eventType === "result" && event.isError && Boolean(event.summary)
  );
}

/** Last errored result line's summary; closest thing to a failure message in the stream. */
function failureSummary(state: NodeRunState | undefined): string | null {
  const failure = [...(state?.transcript ?? [])].reverse().find(isFailedResult);

  return failure?.summary ?? null;
}

function toFailedStep(event: RunStreamEvent): FailedStep {
  return {
    tool:
      event.toolName ??
      (event.eventType === "result" ? "agent" : event.eventType),
    detail: event.summary ?? "",
  };
}

/** Every errored step with message, in order; concrete causes (tool calls, verdicts) behind the one-line why. */
function erroredSteps(state: NodeRunState | undefined): FailedStep[] {
  return (state?.transcript ?? [])
    .filter((event) => event.isError && event.summary)
    .map(toFailedStep);
}

interface NodeStanding {
  tone: NodeStatusTone;
  terminal: boolean;
  duration: string;
}

interface RowFacts {
  outcome: string | null;
  durationSeconds: number | null;
  iteration: number | null;
  agentCrName: string | null;
  commitSha: string | null;
  startedAt: string | null;
}

const EMPTY_ROW_FACTS: RowFacts = {
  outcome: null,
  durationSeconds: null,
  iteration: null,
  agentCrName: null,
  commitSha: null,
  startedAt: null,
};

function rowFacts(row: AssemblyRunNode | undefined): RowFacts {
  return row
    ? {
        outcome: row.outcome,
        durationSeconds: row.durationSeconds,
        iteration: row.iteration,
        agentCrName: row.agentCrName,
        commitSha: row.commitSha,
        startedAt: row.startedAt ?? null,
      }
    : EMPTY_ROW_FACTS;
}

interface StateFacts {
  eventCount: number;
  droppedCount: number;
  iteration: number | null;
}

const EMPTY_STATE_FACTS: StateFacts = {
  eventCount: 0,
  droppedCount: 0,
  iteration: null,
};

function stateFacts(state: NodeRunState | undefined): StateFacts {
  return state
    ? {
        eventCount: state.transcript.length,
        droppedCount: state.droppedCount,
        iteration: state.iteration,
      }
    : EMPTY_STATE_FACTS;
}

function resolveIteration(row: RowFacts, state: StateFacts): number {
  return row.iteration ?? state.iteration ?? 0;
}

function resolveVisual(
  row: AssemblyRunNode | undefined,
  state: NodeRunState | undefined,
  nodeType: string | undefined,
) {
  return nodeRunVisual(row?.outcome ?? null, state?.status ?? "idle", nodeType);
}

function resolveStatusLabel(
  visual: { tone: NodeStatusTone; label: string },
  terminal: boolean,
): string {
  return visual.tone === "idle" && terminal ? "Terminal" : visual.label;
}

function resolveOutcomeLabel(running: boolean, outcome: string | null): string {
  return running ? "in progress" : (outcome ?? "—");
}

function resolveDurationLabel(
  running: boolean,
  durationSeconds: number | null,
): string {
  return running ? "running" : formatDuration(durationSeconds);
}

function resolveFailures(
  tone: NodeStatusTone,
  state: NodeRunState | undefined,
): FailedStep[] {
  return tone === "err" ? erroredSteps(state) : [];
}

interface WhyArgs {
  noun: string;
  type: string | undefined;
  input: NodeDetailInput;
  terminal: boolean;
  duration: string;
}

// Parked human station: reader needs to know whose move it is (often their own).
function whyWaiting({ type }: WhyArgs): string {
  return (
    humanStation(type)?.whyParked ??
    "Parked — waiting for you to review this round."
  );
}

function whyOk({ noun, input, terminal, duration }: WhyArgs): string {
  const finalNote = terminal ? " Final step of the run." : "";

  return `Ran ${noun} and emitted ${input.row?.outcome ?? "success"} in ${duration}.${finalNote}`;
}

function whyErr({ noun, input }: WhyArgs): string {
  return `Failed: ${failureSummary(input.state) ?? input.reason ?? `${noun} did not complete`}.`;
}

function whyIdle({ terminal }: WhyArgs): string {
  return terminal
    ? "Terminal marker — the run ends here."
    : "Not reached — the run finished along another branch before it ran.";
}

const WHY_BY_TONE: Record<NodeStatusTone, (args: WhyArgs) => string> = {
  running: ({ noun }) => `In progress — ${noun} is running.`,
  waiting: whyWaiting,
  ok: whyOk,
  warn: ({ noun, duration }) =>
    `Ran ${noun} and requested changes in ${duration}.`,
  err: whyErr,
  idle: whyIdle,
};

function whyText(
  input: NodeDetailInput,
  type: string | undefined,
  { tone, terminal, duration }: NodeStanding,
): string {
  const noun = type ? `the ${type} node` : "this step";

  return WHY_BY_TONE[tone]({ noun, type, input, terminal, duration });
}

export function describeNode(input: NodeDetailInput): NodeDetail {
  const node = input.definition?.nodes.find((n) => n.id === input.nodeId);
  const nodeType = node?.type;
  const visual = resolveVisual(input.row, input.state, nodeType);
  const terminal = isTerminal(input.definition, input.nodeId);
  const row = rowFacts(input.row);
  const state = stateFacts(input.state);
  const running = visual.tone === "running";

  return {
    tone: visual.tone,
    statusLabel: resolveStatusLabel(visual, terminal),
    why: whyText(input, nodeType, {
      tone: visual.tone,
      terminal,
      duration: formatDuration(row.durationSeconds),
    }),
    failures: resolveFailures(visual.tone, input.state),
    files: uniqueFiles(input.state),
    eventCount: state.eventCount,
    droppedCount: state.droppedCount,
    nodeType: nodeType ?? null,
    outcomeLabel: resolveOutcomeLabel(running, row.outcome),
    durationLabel: resolveDurationLabel(running, row.durationSeconds),
    iteration: resolveIteration(row, state),
    agentCrName: row.agentCrName,
    commitSha: row.commitSha,
    durationSeconds: row.durationSeconds,
    startedAt: row.startedAt,
  };
}
