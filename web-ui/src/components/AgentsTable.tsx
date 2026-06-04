'use client';

import { useState } from 'react';
import HelpPopover from '@/components/HelpPopover';
import { formatCost, truncate, displayCreatedBy } from '@/lib/task-presenter';
import type { AgentKind } from '@/lib/agent-classify';

export interface AgentRow {
  agent_id: string;
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
}

const KIND_LABEL: Record<AgentKind, string> = {
  local: 'Local MCP',
  task: 'Task',
};

/**
 * Shared agents table for the global `/agents` page and the per-repo Agents tab.
 * Local MCP agents (the persistent developer agents that accumulate memories)
 * are shown by default; ephemeral task agents are audit-only and stay hidden
 * behind a toggle. Pure presentation — the container runs the query and tags
 * each row with its `kind` via `classifyAgent`.
 */
export default function AgentsTable({ agents, intro }: AgentsTableProps) {
  const [showTaskAgents, setShowTaskAgents] = useState(false);

  const taskAgentCount = agents.filter((a) => a.kind === 'task').length;
  const visible = showTaskAgents ? agents : agents.filter((a) => a.kind === 'local');
  const hasWhy = agents.some((a) => a.reason != null || a.reason_type != null);
  const columnCount = hasWhy ? 8 : 7;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ margin: 0 }}>Agents</h2>
        <HelpPopover label="What agents are">
          <p>Two kinds of agents show up here:</p>
          <ul>
            <li>
              <strong>Local MCP</strong> agents are developers&apos; own agents — your
              stable <code>~/.lore/agent-id</code>. They write <strong>memory</strong> and{' '}
              <strong>facts</strong> over the MCP server but never claim pipeline tasks.
            </li>
            <li>
              <strong>Task</strong> agents are ephemeral — one per pipeline task run. They
              exist for auditing, so they&apos;re hidden until you ask for them.
            </li>
          </ul>
          <p>
            <strong>Cost</strong> sums tracked <code>llm_calls</code>; headless agent token
            spend is not metered, so it is a lower bound.
          </p>
        </HelpPopover>
      </div>
      {intro && (
        <p className="meta" style={{ marginTop: '6px', marginBottom: '16px' }}>
          {intro}
        </p>
      )}

      {taskAgentCount > 0 && (
        <button
          type="button"
          className="badge"
          aria-pressed={showTaskAgents}
          onClick={() => setShowTaskAgents((v) => !v)}
          style={{ marginBottom: '12px', cursor: 'pointer' }}
        >
          {showTaskAgents
            ? 'Hide task agents'
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
          {visible.map((a) => (
            <tr key={a.agent_id}>
              <td>
                <a href={`/agents/${encodeURIComponent(a.agent_id)}`}>{a.agent_id}</a>
              </td>
              <td>
                <span className="badge">{KIND_LABEL[a.kind]}</span>
              </td>
              <td className="meta">{displayCreatedBy(a.created_by)}</td>
              {hasWhy && (
                <td>
                  {a.reason_type && <span className="badge">{a.reason_type}</span>}{' '}
                  <span className="meta">{truncate(a.reason, 50)}</span>
                </td>
              )}
              <td>{a.task_count}</td>
              <td>{formatCost(a.cost_usd)}</td>
              <td>{a.memory_count}</td>
              <td className="meta">
                {a.last_active ? new Date(a.last_active).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={columnCount} className="meta" style={{ textAlign: 'center' }}>
                No agents to show yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
