/**
 * Pure view-model deriver for the Dark Factory console tab. Folds the resolved
 * settings, the repo's recent tasks, and its dark-factory audit events into a
 * render-ready model (container/presentational, data-down). Activation is
 * `active` when the repo is enabled (all tasks run on the agent-cr subsystem).
 */

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

function summarize(event: ConsoleAuditEvent): string {
  const payload = event.payload ?? {};

  switch (event.event_type) {
    case "auto_merge_decision":
      return `Auto-merge: ${payload.outcome ?? "unknown"}`;
    case "escalation_issued":
      return `Escalation: ${payload.reason ?? "needs-human-help"}`;
    case "lease_expired":
      return `Lease takeover (prev ${payload.previous_holder ?? "unknown"})`;
    case "spec_trace_ingest":
      return `Graph ingest: ${payload.validated_by ?? 0} validated_by, ${payload.violated ?? 0} violated`;
    default:
      return event.event_type;
  }
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
