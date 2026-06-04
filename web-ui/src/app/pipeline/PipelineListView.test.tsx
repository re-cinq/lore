// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PipelineListView, { type PipelineTaskRow } from './PipelineListView';

const row = (over: Partial<PipelineTaskRow>): PipelineTaskRow => ({
  id: 'task-1',
  description: 'Implement the widget end to end',
  task_type: 'implementation',
  status: 'running',
  priority: 'normal',
  target_repo: 're-cinq/lore',
  agent_id: 'agent-abc123def456',
  pr_url: 'https://github.com/re-cinq/lore/pull/7',
  pr_number: 7,
  created_by: 'bogdan',
  created_at: '2026-06-01T12:00:00.000Z',
  ...over,
});

describe('PipelineListView', () => {
  it('renders the heading and the Create Task link', () => {
    render(<PipelineListView tasks={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
    const create = screen.getByRole('link', { name: '+ Create Task' });
    expect(create).toHaveAttribute('href', '/pipeline/create');
  });

  it('marks the All filter active and links every status when no status is selected', () => {
    render(<PipelineListView tasks={[]} />);
    const all = screen.getByRole('link', { name: 'All' });
    expect(all).toHaveAttribute('href', '/pipeline');
    expect(all).toHaveClass('active');

    const queued = screen.getByRole('link', { name: 'queued' });
    expect(queued).toHaveAttribute('href', '/pipeline?status=queued');
    expect(queued).not.toHaveClass('active');

    // every static status renders a filter link.
    for (const s of ['pending', 'queued', 'running', 'pr-created', 'review', 'merged', 'failed', 'cancelled']) {
      expect(screen.getByRole('link', { name: s })).toHaveAttribute('href', `/pipeline?status=${s}`);
    }
  });

  it('marks the matching status filter active and not the All link when a status is selected', () => {
    render(<PipelineListView activeStatus="failed" tasks={[]} />);
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'failed' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'running' })).not.toHaveClass('active');
  });

  it('renders the task description truncated to 60 chars with a trailing ellipsis linking to the detail page', () => {
    const longDescription = 'x'.repeat(80);
    render(<PipelineListView tasks={[row({ id: 'task-9', description: longDescription })]} />);
    const link = screen.getByRole('link', { name: 'x'.repeat(60) + '...' });
    expect(link).toHaveAttribute('href', '/pipeline/task-9');
  });

  it('renders the type badge and the status badge with the status class', () => {
    render(<PipelineListView tasks={[row({ task_type: 'review', status: 'merged' })]} />);
    // "review" and "merged" also appear as filter links, so scope to the table.
    const table = screen.getByRole('table');
    expect(within(table).getByText('review')).toHaveClass('badge');
    const status = within(table).getByText('merged');
    expect(status.className).toEqual('op-badge op-merged');
  });

  it('renders a Run Now POST form for a pending normal-priority task', () => {
    render(<PipelineListView tasks={[row({ id: 'task-rn', status: 'pending', priority: 'normal' })]} />);
    const button = screen.getByRole('button', { name: 'Run Now' });
    expect(button).toHaveAttribute('type', 'submit');
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '/api/pipeline/task-rn/run-now');
    expect(form).toHaveAttribute('method', 'POST');
    // the priority badge fallbacks are not rendered in this branch.
    expect(screen.queryByText('normal')).not.toBeInTheDocument();
  });

  it('renders an immediate-priority badge with the red modifier when not pending-normal', () => {
    render(<PipelineListView tasks={[row({ status: 'running', priority: 'immediate' })]} />);
    expect(screen.queryByRole('button', { name: 'Run Now' })).not.toBeInTheDocument();
    const badge = screen.getByText('immediate');
    expect(badge.className).toEqual('badge badge-red');
  });

  it('renders a plain meta priority for a normal-priority task that is not pending', () => {
    render(<PipelineListView tasks={[row({ status: 'running', priority: 'normal' })]} />);
    expect(screen.queryByRole('button', { name: 'Run Now' })).not.toBeInTheDocument();
    const priority = screen.getByText('normal');
    expect(priority.className).toEqual('meta');
  });

  it('links the target repo when present', () => {
    render(<PipelineListView tasks={[row({ target_repo: 're-cinq/lore' })]} />);
    const repo = screen.getByRole('link', { name: 're-cinq/lore' });
    expect(repo).toHaveAttribute('href', '/repos/re-cinq/lore');
  });

  it('shows an em dash for the repo and the agent when both are absent', () => {
    render(
      <PipelineListView
        tasks={[row({ target_repo: '', agent_id: null, pr_url: 'https://example.com/pr', pr_number: null })]}
      />,
    );
    // repo em dash + agent em dash (PR has a url so it is not an em dash here).
    expect(screen.getAllByText('—').length).toEqual(2);
  });

  it('shortens the agent id to 12 chars with an ellipsis', () => {
    render(<PipelineListView tasks={[row({ agent_id: 'agent-very-long-identifier' })]} />);
    expect(screen.getByText('agent-very-l...')).toBeInTheDocument();
  });

  it('renders a PR link and the status badge when pr_url and pr_number are present', () => {
    render(
      <PipelineListView
        tasks={[row({ id: 'task-pr', pr_url: 'https://github.com/re-cinq/lore/pull/42', pr_number: 42 })]}
      />,
    );
    const pr = screen.getByRole('link', { name: 'PR' });
    expect(pr).toHaveAttribute('href', 'https://github.com/re-cinq/lore/pull/42');
    expect(pr).toHaveAttribute('target', '_blank');
  });

  it('renders the PR link without a status badge when pr_url is present but pr_number is null', () => {
    render(
      <PipelineListView
        tasks={[row({ pr_url: 'https://github.com/re-cinq/lore/pull/8', pr_number: null, target_repo: 're-cinq/lore', agent_id: 'agent-abc123def456' })]}
      />,
    );
    expect(screen.getByRole('link', { name: 'PR' })).toBeInTheDocument();
    // no em dash anywhere: repo, agent and PR are all populated.
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('renders an em dash instead of a PR link when pr_url is null', () => {
    render(<PipelineListView tasks={[row({ pr_url: null, pr_number: null })]} />);
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('link', { name: 'PR' })).not.toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
  });

  it('formats the created_at timestamp via toLocaleString', () => {
    const created = '2026-06-01T12:00:00.000Z';
    render(<PipelineListView tasks={[row({ created_at: created })]} />);
    expect(screen.getByText(new Date(created).toLocaleString())).toBeInTheDocument();
  });

  it('renders one row per task', () => {
    render(
      <PipelineListView
        tasks={[
          row({ id: 'task-a', description: 'First task that is sufficiently long here', status: 'pending', priority: 'normal' }),
          row({ id: 'task-b', description: 'Second task that is sufficiently long too', status: 'running', priority: 'immediate', pr_url: null, pr_number: null }),
        ]}
      />,
    );
    const table = screen.getByRole('table');
    // 1 header row + 2 body rows.
    expect(within(table).getAllByRole('row').length).toEqual(3);
  });

  it('shows the No tasks empty-state row when there are no tasks', () => {
    render(<PipelineListView tasks={[]} />);
    expect(screen.getByText('No tasks')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'PR' })).not.toBeInTheDocument();
  });
});
