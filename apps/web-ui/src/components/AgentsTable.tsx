"use client";

import { useState } from "react";
import HelpPopover from "@/components/HelpPopover";
import { EmptyState } from "@/components/EmptyState";
import { formatCost, truncate, displayCreatedBy } from "@/lib/task-presenter";
import type { AgentKind } from "@/lib/agent-classify";
import styles from "./AgentsTable.module.css";

export interface AgentRow {
  /** Nullable, as the contract says: the activity read groups rows that carry no
   *  agent. It used to be typed `string`, which linked to `/agents/null`. */
  agent_id: string | null;
  kind: AgentKind;
  task_count: number;
  memory_count: number;
  cost_usd: number;
  created_by: string | null;
  last_active: string | null;
  reason_type?: string | null;
  reason?: string | null;
}

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

/**
 * Shared sessions/agents table for the global `/agents` page and the per-repo
 * Agents tab. Each row is a `session` — a developer's local MCP agent (stable
 * `~/.lore/agent-id`, accumulates memories) shown by default, or an ephemeral
 * per-task-run agent kept behind the audit toggle. Pure presentation — the
 * container runs the query and tags each row with its `kind` via `classifyAgent`.
 * `embedded` drops the built-in heading so a parent section owns the chrome.
 */
export default function AgentsTable({
  agents,
  intro,
  title = "Agents",
  embedded = false,
}: AgentsTableProps) {
  const [showTaskAgents, setShowTaskAgents] = useState(false);

  const taskAgentCount = agents.filter((a) => a.kind === "task").length;
  const visible = showTaskAgents
    ? agents
    : agents.filter((a) => a.kind === "local");
  const hasWhy = agents.some((a) => a.reason != null || a.reason_type != null);
  const columnCount = hasWhy ? 8 : 7;

  return (
    <div>
      {!embedded && (
        <>
          <div className={styles.head}>
            <h2 className={styles.heading}>{title}</h2>
            <HelpPopover label="What agents are">
              <p>Two kinds of session show up here:</p>
              <ul>
                <li>
                  <strong>Local MCP</strong> agents are developers&apos; own
                  agents — your stable <code>~/.lore/agent-id</code>. They write{" "}
                  <strong>memory</strong> and <strong>facts</strong> over the
                  MCP server but never claim pipeline tasks.
                </li>
                <li>
                  <strong>Task</strong> agents are ephemeral — one per pipeline
                  task run. They exist for auditing, so they&apos;re hidden
                  until you ask for them.
                </li>
              </ul>
              <p>
                <strong>Cost</strong> sums tracked <code>llm_calls</code>;
                headless agent token spend is not metered, so it is a lower
                bound.
              </p>
            </HelpPopover>
          </div>
          {intro && <p className={`meta ${styles.intro}`}>{intro}</p>}
        </>
      )}

      {taskAgentCount > 0 && (
        <button
          type="button"
          className={`badge ${styles.toggle}`}
          aria-pressed={showTaskAgents}
          onClick={() => setShowTaskAgents((v) => !v)}
        >
          {showTaskAgents
            ? "Hide task agents"
            : `Show task agents (audit) — ${taskAgentCount} hidden`}
        </button>
      )}

      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Type</th>
            <th>Created by</th>
            {hasWhy && <th>Why</th>}
            <th>Tasks</th>
            <th>Cost</th>
            <th>Memories</th>
            <th>Last Active</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a, index) => (
            <tr key={a.agent_id ?? `unattributed-${index}`}>
              <td>
                {a.agent_id ? (
                  <a href={`/agents/${encodeURIComponent(a.agent_id)}`}>
                    {a.agent_id}
                  </a>
                ) : (
                  <span className="meta">—</span>
                )}
              </td>
              <td>
                <span className="badge">{KIND_LABEL[a.kind]}</span>
              </td>
              <td className="meta">{displayCreatedBy(a.created_by)}</td>
              {hasWhy && (
                <td>
                  {a.reason_type && (
                    <span className="badge">{a.reason_type}</span>
                  )}{" "}
                  <span className="meta">{truncate(a.reason, 50)}</span>
                </td>
              )}
              <td>{a.task_count}</td>
              <td>{formatCost(a.cost_usd)}</td>
              <td>{a.memory_count}</td>
              <td className="meta">
                {a.last_active ? new Date(a.last_active).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={columnCount}>
                <EmptyState
                  title="No agents yet"
                  description="Agents appear as developers use the Lore MCP server. Per-task run agents stay behind the audit toggle."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
