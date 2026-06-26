// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RepoTasksView, { type RepoTaskRow } from './RepoTasksView';

const row = (over: Partial<RepoTaskRow>): RepoTaskRow => ({
  id: 'task-1',
  description: 'Implement the widget',
  task_type: 'implementation',
  status: 'running',
  agent_id: 'agent-abc123',
  pr_url: 'https://github.com/re-cinq/lore/pull/7',
  created_at: '2026-06-01T12:00:00.000Z',
  created_by: 'bogdan',
  cost_usd: 0.1234,
  ...over,
});

describe('RepoTasksView', () => {
  it('renders the heading, intro copy and New Task link', () => {
    render(<RepoTasksView owner="re-cinq" repo="lore" tasks={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Tasks' })).toBeInTheDocument();
    expect(
      screen.getByText(/Pipeline tasks targeting this repo/),
    ).toBeInTheDocument();
    const newTask = screen.getByRole('link', { name: '+ New Task' });
    expect(newTask).toHaveAttribute('href', '/repos/re-cinq/lore/tasks/create');
  });

  it('renders one row per task with description link, type and status badges', () => {
    render(
      <RepoTasksView
        owner="re-cinq"
        repo="lore"
        tasks={[
          row({ id: 'task-1', description: 'Implement the widget', task_type: 'implementation', status: 'running' }),
          row({ id: 'task-2', description: 'Review the PR', task_type: 'review', status: 'done', pr_url: null }),
        ]}
      />,
    );

    const descLink = screen.getByRole('link', { name: 'Implement the widget' });
    expect(descLink).toHaveAttribute('href', '/assembly-lines/task-1');
    expect(screen.getByRole('link', { name: 'Review the PR' })).toHaveAttribute('href', '/assembly-lines/task-2');

    expect(screen.getByText('implementation')).toHaveClass('badge');
    const status = screen.getByText('running');
    expect(status.className).toEqual('op-badge op-running');
  });

  it('renders a PR link when pr_url is present', () => {
    render(
      <RepoTasksView
        owner="re-cinq"
        repo="lore"
        tasks={[row({ pr_url: 'https://github.com/re-cinq/lore/pull/7' })]}
      />,
    );
    const pr = screen.getByRole('link', { name: 'PR' });
    expect(pr).toHaveAttribute('href', 'https://github.com/re-cinq/lore/pull/7');
    expect(pr).toHaveAttribute('target', '_blank');
  });

  it('renders an em dash instead of a PR link when pr_url is null', () => {
    render(<RepoTasksView owner="re-cinq" repo="lore" tasks={[row({ pr_url: null })]} />);
    expect(screen.queryByRole('link', { name: 'PR' })).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('formats cost, shortens the agent id and shows the creator', () => {
    render(
      <RepoTasksView
        owner="re-cinq"
        repo="lore"
        tasks={[row({ cost_usd: 1.5, agent_id: 'agent-very-long-identifier', created_by: 'alice' })]}
      />,
    );
    expect(screen.getByText('$1.5000')).toBeInTheDocument();
    expect(screen.getByText('agent-very-l…')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('falls back to unknown creator and em-dash agent when those fields are absent', () => {
    render(
      <RepoTasksView
        owner="re-cinq"
        repo="lore"
        tasks={[row({ created_by: null, agent_id: null, description: null })]}
      />,
    );
    expect(screen.getByText('unknown')).toBeInTheDocument();
    // both the null description and the null agent_id render an em dash.
    expect(screen.getAllByText('—').length).toEqual(2);
  });

  it('truncates a long description to 50 characters with an ellipsis', () => {
    const longDescription = 'x'.repeat(80);
    render(
      <RepoTasksView owner="re-cinq" repo="lore" tasks={[row({ description: longDescription })]} />,
    );
    expect(screen.getByText('x'.repeat(50) + '…')).toBeInTheDocument();
  });

  it('shows the empty-state row when there are no tasks', () => {
    render(<RepoTasksView owner="re-cinq" repo="lore" tasks={[]} />);
    expect(screen.getByText('No tasks for this repo')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Implement the widget/ })).not.toBeInTheDocument();
  });
});
