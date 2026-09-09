"use client";

import { type ReactNode, useState } from "react";
import HelpPopover from "@/components/HelpPopover";
import { EmptyState } from "@/components/EmptyState";
import { formatCost, truncate, displayCreatedBy } from "@/lib/task-presenter";
import type { AgentKind } from "@/lib/agent-classify";
import DataTable from "@/components/DataTable";
import type { components } from "@/lib/api/schema";
import styles from "./AgentsTable.module.css";

// AgentActivity's per-agent fields, plus `kind` (derived client-side, not part of the wire response).
type AgentActivityRow =
  components["schemas"]["AgentActivity"]["agents"][number];

export type AgentRow = Pick<
  AgentActivityRow,
  | "agent_id"
  | "task_count"
  | "memory_count"
  | "cost_usd"
  | "created_by"
  | "last_active"
> & {
  kind: AgentKind;
  reason_type?: AgentActivityRow["reason_type"];
  reason?: AgentActivityRow["reason"];
};

export interface AgentsTableProps {
  agents: AgentRow[];
  /** Intro line under the heading; lets each surface describe its scope. */
  intro?: string;
  /** Heading text — "Agents" on the global page, "Sessions" on the repo tab. */
  title?: string;
  /** Drop the built-in heading/help/intro so a parent section owns the chrome. */
  embedded?: boolean;
}

const KIND_LABEL: Record<AgentKind, string> = {
  local: "Local MCP",
  task: "Task",
};

// Task agents are ephemeral audit rows, so they stay behind the toggle until asked for.
function localAgents(agents: AgentRow[]): AgentRow[] {
  return agents.filter((a) => a.kind === "local");
}

// The Why column exists only when some agent has a reason to show.
function hasReasonColumn(agents: AgentRow[]): boolean {
  return agents.some((a) => a.reason != null || a.reason_type != null);
}

type WhyColumn = Pick<AgentRowsProps, "hasWhy">;

function agentColumns(cols: WhyColumn): string[] {
  return [
    "Agent",
    "Type",
    "Created by",
    ...(cols.hasWhy ? ["Why"] : []),
    "Tasks",
    "Cost",
    "Memories",
    "Last Active",
  ];
}

/** The collapsed half of the audit toggle; the expanded half is a fixed word. */
function auditToggleLabel(taskAgentCount: number): string {
  return `Show task agents (audit) — ${taskAgentCount} hidden`;
}

interface TaskAgentsToggleProps {
  taskAgentCount: number;
  showTaskAgents: boolean;
  onToggle: () => void;
}

function TaskAgentsToggle({
  taskAgentCount,
  showTaskAgents,
  onToggle,
}: TaskAgentsToggleProps) {
  if (taskAgentCount === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className={`badge ${styles.toggle}`}
      aria-pressed={showTaskAgents}
      onClick={onToggle}
    >
      {showTaskAgents ? "Hide task agents" : auditToggleLabel(taskAgentCount)}
    </button>
  );
}

/** The "why" cell, present only when some agent HAS a reason — a column of dashes says less than no column. */
function whyCells(a: AgentRow, cols: WhyColumn): ReactNode[] {
  if (!cols.hasWhy) {
    return [];
  }

  return [
    <span key="why">
      {a.reason_type && <span className="badge">{a.reason_type}</span>}{" "}
      <span className="meta">{truncate(a.reason, 50)}</span>
    </span>,
  ];
}

// One agent's row, in column order.
function agentCells(a: AgentRow, cols: WhyColumn): ReactNode[] {
  return [
    <AgentLink agentId={a.agent_id} key="agent" />,
    <span className="badge" key="kind">
      {KIND_LABEL[a.kind]}
    </span>,
    <span className="meta" key="by">
      {displayCreatedBy(a.created_by)}
    </span>,
    ...whyCells(a, cols),
    a.task_count,
    formatCost(a.cost_usd),
    a.memory_count,
    <span className="meta" key="active">
      {a.last_active ? new Date(a.last_active).toLocaleString() : "—"}
    </span>,
  ];
}

interface AgentRowsProps {
  agents: AgentsTableProps["agents"];
  hasWhy: boolean;
}

/** The table proper. Keyed on `agent_id`, falling back to the row index for calls nothing attributed — an unattributed row is still a row, and dropping it would make the totals disagree with the list. */
function AgentRows({ agents, hasWhy }: AgentRowsProps) {
  return (
    <DataTable
      columns={agentColumns({ hasWhy })}
      rows={agents}
      rowKey={(a, index) => a.agent_id ?? `unattributed-${index}`}
      empty={
        <EmptyState
          title="No agents yet"
          description="Agents appear as developers use the Lore MCP server. Per-task run agents stay behind the audit toggle."
        />
      }
      cells={(a) => agentCells(a, { hasWhy })}
    />
  );
}

/** Shared sessions/agents table for `/agents` and the per-repo Agents tab; pure presentation, the container tags each row's `kind` via `classifyAgent`. */
export default function AgentsTable(props: AgentsTableProps) {
  const { agents, intro, title = "Agents", embedded = false } = props;
  const [showTaskAgents, setShowTaskAgents] = useState(false);
  const taskAgentCount = agents.filter((a) => a.kind === "task").length;
  const visible = showTaskAgents ? agents : localAgents(agents);
  const hasWhy = hasReasonColumn(agents);

  return (
    <div>
      {!embedded && <AgentsTableHeading title={title} intro={intro} />}
      <TaskAgentsToggle
        taskAgentCount={taskAgentCount}
        showTaskAgents={showTaskAgents}
        onToggle={() => setShowTaskAgents((v) => !v)}
      />
      <AgentRows agents={visible} hasWhy={hasWhy} />
    </div>
  );
}

function AgentLink({ agentId }: { agentId: string | null }) {
  if (!agentId) {
    return <span className="meta">—</span>;
  }

  return <a href={`/agents/${encodeURIComponent(agentId)}`}>{agentId}</a>;
}

/** What an agent IS, said once beside the table rather than in every page that embeds it. */
function AgentsTableHeading({
  title,
  intro,
}: {
  title: string;
  intro?: string;
}) {
  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.heading}>{title}</h2>
        <AgentKindsHelp />
      </div>
      {intro && <p className={`meta ${styles.intro}`}>{intro}</p>}
    </>
  );
}

// The distinction between the two kinds of agent.
function AgentKindsPoints() {
  return (
    <ul>
      <li>
        <strong>Local MCP</strong> agents are developers&apos; own agents — your
        stable <code>~/.lore/agent-id</code>. They write <strong>memory</strong>{" "}
        and <strong>facts</strong> over the MCP server but never claim pipeline
        tasks.
      </li>
      <li>
        <strong>Task</strong> agents are ephemeral — one per pipeline task run.
        They exist for auditing, so they&apos;re hidden until you ask for them.
      </li>
    </ul>
  );
}

/** What the two kinds are, and the caveat on cost. Both are things a reader asks once and then knows, which is what a popover is for — a permanent paragraph would be re-read on every visit. */
function AgentKindsHelp() {
  return (
    <HelpPopover label="What agents are">
      <p>Two kinds of session show up here:</p>
      <AgentKindsPoints />
      <p>
        <strong>Cost</strong> sums tracked <code>llm_calls</code>; headless
        agent token spend is not metered, so it is a lower bound.
      </p>
    </HelpPopover>
  );
}
