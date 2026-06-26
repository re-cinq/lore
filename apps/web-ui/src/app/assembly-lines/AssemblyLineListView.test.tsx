// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import AssemblyLineListView from './AssemblyLineListView';
import { groupTasksIntoAssemblyLines, type AssemblyLineTaskRow } from '@/lib/assembly-lines';

const taskRow = (over: Partial<AssemblyLineTaskRow>): AssemblyLineTaskRow => ({
  id: 'task-abcd1234',
  description: 'Implement the widget end to end',
  task_type: 'implementation',
  status: 'running',
  priority: 'normal',
  target_repo: 're-cinq/lore',
  agent_id: 'agent-abc',
  pr_url: null,
  pr_number: null,
  target_branch: null,
  parent_task_id: null,
  retry_of: null,
  created_by: 'bogdan',
  created_at: '2026-06-01T12:00:00.000Z',
  updated_at: '2026-06-01T12:00:00.000Z',
  ...over,
});

const group = (...rows: AssemblyLineTaskRow[]) => groupTasksIntoAssemblyLines(rows);

describe('AssemblyLineListView', () => {
  it('renders the heading and the Create Task link', () => {
    render(<AssemblyLineListView runs={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Assembly Lines' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Create Task' })).toHaveAttribute('href', '/assembly-lines/create');
  });

  it('marks All active and links every rolled-up status filter when none is selected', () => {
    render(<AssemblyLineListView runs={[]} />);
    const all = screen.getByRole('link', { name: 'All' });
    expect(all).toHaveAttribute('href', '/assembly-lines');
    expect(all).toHaveClass('active');

    const labels: [string, string][] = [
      ['Running', 'running'],
      ['PR created', 'pr-created'],
      ['In review', 'review'],
      ['Merged', 'merged'],
      ['Failed', 'failed'],
      ['Needs human', 'needs-human'],
      ['Pending', 'pending'],
    ];
    for (const [label, key] of labels) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `/assembly-lines?status=${key}`);
    }
  });

  it('marks the matching filter active and not All when a status is selected', () => {
    render(<AssemblyLineListView activeStatus="failed" runs={[]} />);
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Failed' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Running' })).not.toHaveClass('active');
  });

  it('renders the empty-state row when there are no runs', () => {
    render(<AssemblyLineListView runs={[]} />);
    expect(screen.getByText('No assembly lines')).toBeInTheDocument();
  });

  it('renders a singleton run as one row with a single-stage mini-graph linking to the lead', () => {
    const runs = group(taskRow({ id: 'task-abcd1234', status: 'running', target_branch: 'lore/x', pr_url: 'https://gh/pr/3', pr_number: 3 }));
    render(<AssemblyLineListView runs={runs} />);

    expect(screen.getAllByTestId('al-stage')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '#task-abc' })).toHaveAttribute('href', '/assembly-lines/task-abcd1234');
    expect(screen.getByRole('link', { name: 're-cinq/lore' })).toHaveAttribute('href', '/repos/re-cinq/lore');
    expect(screen.getByText('lore/x')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#3' })).toHaveAttribute('href', 'https://gh/pr/3');
  });

  it('rolls the status up to the table — an in-flight member reads as Running', () => {
    const impl = taskRow({ id: 'impl', status: 'merged', target_branch: 'lore/y', created_at: '2026-06-01T10:00:00.000Z' });
    const review = taskRow({ id: 'review', task_type: 'review', status: 'running', parent_task_id: 'impl', target_branch: 'lore/y', created_at: '2026-06-01T11:00:00.000Z' });
    render(<AssemblyLineListView runs={group(review, impl)} />);
    const table = screen.getByRole('table');
    // the "Running" chip also lives in the filter bar, so scope to the table body.
    expect(within(table).getByText('Running')).toBeInTheDocument();
  });

  it('renders one stage dot per member with a dropdown link to each member', () => {
    const impl = taskRow({ id: 'impl-aaaa', status: 'merged', target_branch: 'lore/y', created_at: '2026-06-01T10:00:00.000Z' });
    const review = taskRow({ id: 'review-bbbb', task_type: 'review', status: 'running', parent_task_id: 'impl-aaaa', target_branch: 'lore/y', created_at: '2026-06-01T11:00:00.000Z' });
    const { container } = render(<AssemblyLineListView runs={group(review, impl)} />);

    expect(screen.getAllByTestId('al-stage')).toHaveLength(2);
    expect(container.querySelector('a[href="/assembly-lines/impl-aaaa"]')).toBeTruthy();
    expect(container.querySelector('a[href="/assembly-lines/review-bbbb"]')).toBeTruthy();
  });

  it('renders a Run Now POST form when the lead task is pending', () => {
    render(<AssemblyLineListView runs={group(taskRow({ id: 'p1', status: 'pending' }))} />);
    const form = screen.getByRole('button', { name: 'Run Now' }).closest('form');
    expect(form).toHaveAttribute('action', '/api/assembly-lines/p1/run-now');
    expect(form).toHaveAttribute('method', 'POST');
  });

  it('renders an Open PR link only when the run has a PR url', () => {
    render(<AssemblyLineListView runs={group(taskRow({ pr_url: 'https://gh/pr/9', pr_number: 9 }))} />);
    expect(screen.getByRole('link', { name: 'Open PR' })).toHaveAttribute('href', 'https://gh/pr/9');
  });

  it('renders the PR badge as plain "PR" and no status pill when pr_number is absent', () => {
    const { container } = render(<AssemblyLineListView runs={group(taskRow({ pr_url: 'https://gh/pr/x', pr_number: null }))} />);
    expect(screen.getByRole('link', { name: 'PR' })).toHaveAttribute('href', 'https://gh/pr/x');
    expect(container.querySelector('.status-pill')).toBeNull();
  });

  it('omits the repo link when the run has no target repo', () => {
    render(<AssemblyLineListView runs={group(taskRow({ target_repo: '', pr_url: null }))} />);
    expect(screen.queryByRole('link', { name: 're-cinq/lore' })).not.toBeInTheDocument();
  });

  it('shows uppercase initials for the creator', () => {
    render(<AssemblyLineListView runs={group(taskRow({ created_by: 'review-agent' }))} />);
    expect(screen.getByText('RE')).toBeInTheDocument();
  });

  it('falls back to an em dash when the creator is blank', () => {
    render(<AssemblyLineListView runs={group(taskRow({ created_by: '' }))} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
