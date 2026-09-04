/** View-model deriver: fold settings, tasks, and audit events into render-ready model for Dark Factory console. */

import type { ResolvedDarkFactorySettings } from "@/lib/dark-factory-resolve";
import type { components } from "@/lib/api/schema";

/** The five task fields the console derives from, typed by the contract. */
export type ConsoleTask = Pick<
  components["schemas"]["RepoTaskList"]["tasks"][number],
  "id" | "task_type" | "status" | "pr_url" | "created_at"
>;

export type ConsoleAuditEvent =
  components["schemas"]["AuditLogPage"]["entries"][number];

export interface DarkFactoryConsoleInput {
  resolved: ResolvedDarkFactorySettings;
  trustLevel: string;
  tasks: ConsoleTask[];
  decisions: ConsoleAuditEvent[];
}

export type ActivationState = "active" | "disabled";

export interface Activation {
  state: ActivationState;
  reason: string;
  repoEnabled: boolean;
}

export interface WorkItem {
  id: string;
  type: string;
  status: string;
  prUrl: string | null;
  createdAt: string;
}

export interface DecisionItem {
  kind: string;
  summary: string;
  createdAt: string;
}

export interface DarkFactoryConsoleModel {
  activation: Activation;
  config: ResolvedDarkFactorySettings;
  trustLevel: string;
  workItems: WorkItem[];
  decisions: DecisionItem[];
}

function deriveActivation(
  repoEnabled: boolean,
): Pick<Activation, "state" | "reason"> {
  if (!repoEnabled) {
    return {
      state: "disabled",
      reason: "Repo opted out — dark_factory.enabled is false.",
    };
  }

  return {
    state: "active",
    reason: "Repo enabled — tasks run on the agent-cr subsystem.",
  };
}

type AuditPayload = ConsoleAuditEvent["payload"];

function summarizeAutoMerge(payload: AuditPayload): string {
  return `Auto-merge: ${payload.outcome ?? "unknown"}`;
}

function summarizeEscalation(payload: AuditPayload): string {
  return `Escalation: ${payload.reason ?? "needs-human-help"}`;
}

function summarizeLeaseExpired(payload: AuditPayload): string {
  return `Lease takeover (prev ${payload.previous_holder ?? "unknown"})`;
}

function summarizeSpecTraceIngest(payload: AuditPayload): string {
  return `Graph ingest: ${payload.validated_by ?? 0} validated_by, ${payload.violated ?? 0} violated`;
}

const SUMMARIZERS: Record<string, (payload: AuditPayload) => string> = {
  auto_merge_decision: summarizeAutoMerge,
  escalation_issued: summarizeEscalation,
  lease_expired: summarizeLeaseExpired,
  spec_trace_ingest: summarizeSpecTraceIngest,
};

function summarize(event: ConsoleAuditEvent): string {
  const payload = event.payload ?? {};
  const summarizer = SUMMARIZERS[event.event_type];

  return summarizer ? summarizer(payload) : event.event_type;
}

export function deriveDarkFactoryConsole(
  input: DarkFactoryConsoleInput,
): DarkFactoryConsoleModel {
  return {
    activation: {
      ...deriveActivation(input.resolved.enabled),
      repoEnabled: input.resolved.enabled,
    },
    config: input.resolved,
    trustLevel: input.trustLevel,
    workItems: input.tasks.map((task) => ({
      id: task.id,
      type: task.task_type,
      status: task.status,
      prUrl: task.pr_url,
      createdAt: task.created_at,
    })),
    decisions: input.decisions.map((event) => ({
      kind: event.event_type,
      summary: summarize(event),
      createdAt: event.created_at,
    })),
  };
}
