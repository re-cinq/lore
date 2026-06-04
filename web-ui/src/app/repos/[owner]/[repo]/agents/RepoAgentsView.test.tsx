// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import RepoAgentsView, { type RepoAgentRow } from './RepoAgentsView';

const row = (over: Partial<RepoAgentRow>): RepoAgentRow => ({
  agent_id: 'agent-abc123',
  task_count: 3,
  cost_usd: 0.1234,
  created_by: 'bogdan',
  reason_type: 'implementation',
  reason: 'Implement the widget',
  last_active: '2026-06-01T12:00:00.000Z',
  memory_count: 7,
  ...over,
});

describe('RepoAgentsView', () => {
  it('renders the heading, help popover and intro copy', () => {
    render(<RepoAgentsView agents={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What agents are' })).toBeInTheDocument();
    expect(
      screen.getByText(/Agents that have worked on this repo, with their task counts/),
    ).toBeInTheDocument();
  });

  it('renders the table column headers', () => {
    render(<RepoAgentsView agents={[]} />);
    const table = screen.getByRole('table');
    for (const header of ['Agent', 'Created by', 'Why', 'Tasks', 'Cost', 'Memories', 'Last Active']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('renders one row per agent with link, counts, cost and creator', () => {
    render(
      <RepoAgentsView
        agents={[
          row({ agent_id: 'agent-abc123', task_count: 3, memory_count: 7, created_by: 'bogdan' }),
          row({ agent_id: 'agent-def456', task_count: 1, memory_count: 0, created_by: 'alice', reason: 'Review the PR', reason_type: 'review' }),
        ]}
      />,
    );

    const first = screen.getByRole('link', { name: 'agent-abc123' });
    expect(first).toHaveAttribute('href', '/agents/agent-abc123');
    expect(screen.getByRole('link', { name: 'agent-def456' })).toHaveAttribute('href', '/agents/agent-def456');

    expect(screen.getByText('bogdan')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('Implement the widget')).toBeInTheDocument();
    expect(within(table).getByText('Review the PR')).toBeInTheDocument();
  });

  it('renders the reason_type as a badge and formats cost to four decimals', () => {
    render(<RepoAgentsView agents={[row({ reason_type: 'implementation', cost_usd: 1.5 })]} />);
    expect(screen.getByText('implementation')).toHaveClass('badge');
    expect(screen.getByText('$1.5000')).toBeInTheDocument();
  });

  it('encodes the agent id in the href', () => {
    render(<RepoAgentsView agents={[row({ agent_id: 'agent abc/123' })]} />);
    const link = screen.getByRole('link', { name: 'agent abc/123' });
    expect(link).toHaveAttribute('href', '/agents/agent%20abc%2F123');
  });

  it('falls back to unknown creator and renders no badge when reason_type is null', () => {
    render(
      <RepoAgentsView agents={[row({ created_by: null, reason_type: null, reason: 'just a reason' })]} />,
    );
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.queryByText('implementation')).not.toBeInTheDocument();
    expect(screen.getByText('just a reason')).toBeInTheDocument();
  });

  it('renders an em dash when reason is null', () => {
    render(<RepoAgentsView agents={[row({ reason: null, reason_type: null })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('truncates a long reason to 50 characters with an ellipsis', () => {
    const longReason = 'x'.repeat(80);
    render(<RepoAgentsView agents={[row({ reason: longReason })]} />);
    expect(screen.getByText('x'.repeat(50) + '…')).toBeInTheDocument();
  });

  it('renders task and memory counts as plain numbers', () => {
    render(<RepoAgentsView agents={[row({ task_count: 12, memory_count: 99 })]} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('12')).toBeInTheDocument();
    expect(within(table).getByText('99')).toBeInTheDocument();
  });

  it('shows the empty-state row when there are no agents', () => {
    render(<RepoAgentsView agents={[]} />);
    expect(screen.getByText('No agents have worked on this repo yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'agent-abc123' })).not.toBeInTheDocument();
  });
});
