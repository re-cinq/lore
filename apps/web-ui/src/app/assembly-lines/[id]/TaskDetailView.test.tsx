// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TaskDetailView, {
  type TaskDetailTask,
  type TaskDetailEvent,
  type TaskDetailLlmCall,
} from './TaskDetailView';

const task = (over: Partial<TaskDetailTask> = {}): TaskDetailTask => ({
  id: 'task-1',
  description: 'Implement the widget',
  task_type: 'implementation',
  status: 'running',
  priority: 'normal',
  target_repo: 're-cinq/lore',
  target_branch: 'feature/widget',
  agent_id: null,
  pr_url: null,
  pr_number: null,
  review_iteration: 0,
  failure_reason: null,
  created_by: 'alice',
  created_at: '2026-06-01T10:00:00Z',
  updated_at: '2026-06-01T11:00:00Z',
  ...over,
});

const event = (over: Partial<TaskDetailEvent> = {}): TaskDetailEvent => ({
  id: 'evt-1',
  from_status: 'pending',
  to_status: 'running',
  metadata: null,
  created_at: '2026-06-01T10:30:00Z',
  ...over,
});

const llmCall = (over: Partial<TaskDetailLlmCall> = {}): TaskDetailLlmCall => ({
  model: 'claude-opus-4',
  input_tokens: 1234,
  output_tokens: 567,
  duration_ms: 4200,
  status: 'success',
  error: null,
  created_at: '2026-06-01T10:45:00Z',
  ...over,
});

const action = vi.fn();

const renderView = (over: Partial<React.ComponentProps<typeof TaskDetailView>> = {}) =>
  render(
    <TaskDetailView
      task={task()}
      events={[]}
      llmCalls={[]}
      failedEvent={undefined}
      submitFeedback={action}
      {...over}
    />,
  );

describe('TaskDetailView', () => {
  it('renders the truncated description heading and core task fields', () => {
    renderView({ task: task({ task_type: 'implementation', target_repo: 're-cinq/lore', created_by: 'alice' }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Task: Implement the widget' })).toBeInTheDocument();
    expect(screen.getByText('implementation')).toBeInTheDocument();
    expect(screen.getByText('re-cinq/lore')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('truncates a description longer than 80 characters in the heading', () => {
    const long = 'x'.repeat(120);
    renderView({ task: task({ description: long }) });
    expect(
      screen.getByRole('heading', { level: 1, name: `Task: ${'x'.repeat(80)}` }),
    ).toBeInTheDocument();
  });

  it('shows priority as a red badge when immediate', () => {
    renderView({ task: task({ priority: 'immediate' }) });
    const badge = screen.getByText('immediate');
    expect(badge).toHaveClass('badge', 'badge-red');
  });

  it('falls back to normal priority label and meta class when priority is empty', () => {
    renderView({ task: task({ priority: '' }) });
    const badge = screen.getByText('normal');
    expect(badge).toHaveClass('meta');
  });

  it('renders the Run Now form only for pending normal-priority tasks', () => {
    const { container } = renderView({ task: task({ status: 'pending', priority: 'normal' }) });
    expect(screen.getByRole('button', { name: 'Run Now' })).toBeInTheDocument();
    expect(container.querySelector('form[action="/api/assembly-lines/task-1/run-now"]')).toBeTruthy();
  });

  it('hides the Run Now form for immediate-priority pending tasks', () => {
    renderView({ task: task({ status: 'pending', priority: 'immediate' }) });
    expect(screen.queryByRole('button', { name: 'Run Now' })).not.toBeInTheDocument();
  });

  it('renders the Cancel Task form for non-terminal tasks', () => {
    const { container } = renderView({ task: task({ status: 'running' }) });
    expect(screen.getByRole('button', { name: 'Cancel Task' })).toBeInTheDocument();
    expect(container.querySelector('form[action="/api/assembly-lines/task-1/cancel"]')).toBeTruthy();
  });

  it('hides the Cancel Task form for merged tasks', () => {
    renderView({ task: task({ status: 'merged', pr_url: 'https://example.com/pr/1', pr_number: 1 }) });
    expect(screen.queryByRole('button', { name: 'Cancel Task' })).not.toBeInTheDocument();
  });

  it('hides the Cancel Task form for completed tasks', () => {
    renderView({ task: task({ status: 'completed' }) });
    expect(screen.queryByRole('button', { name: 'Cancel Task' })).not.toBeInTheDocument();
  });

  it('renders the agent row only when an agent is assigned', () => {
    renderView({ task: task({ agent_id: 'agent-42' }) });
    expect(screen.getByText('Agent:')).toBeInTheDocument();
    expect(screen.getByText('agent-42')).toBeInTheDocument();
  });

  it('omits the agent row when no agent is assigned', () => {
    renderView({ task: task({ agent_id: null }) });
    expect(screen.queryByText('Agent:')).not.toBeInTheDocument();
  });

  it('renders the PR link and PR status card when a PR exists', () => {
    renderView({ task: task({ pr_url: 'https://github.com/re-cinq/lore/pull/7', pr_number: 7 }) });
    const link = screen.getByRole('link', { name: 'https://github.com/re-cinq/lore/pull/7' });
    expect(link).toHaveAttribute('href', 'https://github.com/re-cinq/lore/pull/7');
  });

  it('renders the failure row when a failure reason is present', () => {
    renderView({ task: task({ failure_reason: 'lint failed' }) });
    expect(screen.getByText('Failure:')).toBeInTheDocument();
    expect(screen.getByText('lint failed')).toBeInTheDocument();
  });

  it('renders the review iterations row only when greater than zero', () => {
    renderView({ task: task({ review_iteration: 2 }) });
    expect(screen.getByText('Review iterations:')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('omits the review iterations row when zero', () => {
    renderView({ task: task({ review_iteration: 0 }) });
    expect(screen.queryByText('Review iterations:')).not.toBeInTheDocument();
  });

  it('renders the FailurePanel when the task failed and a failed event carries metadata', () => {
    const failed = event({ to_status: 'failed', metadata: { error: 'agent crashed mid-run' } });
    renderView({
      task: task({ status: 'failed' }),
      events: [failed],
      failedEvent: failed,
    });
    expect(screen.getByRole('heading', { level: 3, name: 'Failure' })).toBeInTheDocument();
    expect(screen.getByText('agent crashed mid-run')).toBeInTheDocument();
  });

  it('does not render the FailurePanel when there is no failed event metadata', () => {
    renderView({ task: task({ status: 'running' }), failedEvent: undefined });
    expect(screen.queryByRole('heading', { level: 3, name: 'Failure' })).not.toBeInTheDocument();
  });

  it('wires the feedback form to the injected action with a hidden task_id', () => {
    const { container } = renderView({
      task: task({ pr_url: 'https://github.com/re-cinq/lore/pull/7', pr_number: 7, status: 'running' }),
    });
    expect(screen.getByRole('heading', { level: 3, name: 'Give Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request Revision' })).toBeInTheDocument();
    expect(container.querySelector('input[name="task_id"]')).toHaveValue('task-1');
    expect(container.querySelector('textarea[name="feedback"]')).toBeTruthy();
  });

  it('hides the feedback form when the task has no PR', () => {
    renderView({ task: task({ pr_url: null }) });
    expect(screen.queryByRole('heading', { level: 3, name: 'Give Feedback' })).not.toBeInTheDocument();
  });

  it('hides the feedback form for cancelled tasks even with a PR', () => {
    renderView({ task: task({ pr_url: 'https://example.com/pr/1', pr_number: 1, status: 'cancelled' }) });
    expect(screen.queryByRole('button', { name: 'Request Revision' })).not.toBeInTheDocument();
  });

  it('renders an event row per event with status badges and from-status arrow', () => {
    renderView({
      events: [
        event({ id: 'e1', from_status: 'pending', to_status: 'running', metadata: { foo: 'bar' } }),
        event({ id: 'e2', from_status: null, to_status: 'queued', metadata: null }),
      ],
    });
    const list = screen.getByRole('heading', { level: 2, name: 'Event Timeline' }).nextElementSibling as HTMLElement;
    expect(within(list).getByText('running')).toBeInTheDocument();
    expect(within(list).getByText('queued')).toBeInTheDocument();
    expect(within(list).getByText('← pending')).toBeInTheDocument();
    expect(within(list).getByText(/"foo": "bar"/)).toBeInTheDocument();
  });

  it('renders a table row per LLM call with success badge and formatted tokens', () => {
    renderView({ llmCalls: [llmCall({ model: 'claude-opus-4', input_tokens: 1234, output_tokens: 567 })] });
    expect(screen.getByRole('cell', { name: 'claude-opus-4' })).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('1,234 / 567')).toBeInTheDocument();
    expect(screen.getByText('4.2s')).toBeInTheDocument();
  });

  it('renders a failed LLM call with a red badge and the error text', () => {
    renderView({
      task: task({ target_repo: 're-cinq/lore' }),
      llmCalls: [llmCall({ status: 'failed', error: 'rate limited', duration_ms: 0 })],
    });
    const failedBadge = screen.getByText('failed');
    expect(failedBadge).toHaveClass('badge', 'badge-red');
    expect(screen.getByText('rate limited')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the empty LLM-calls message when there are none', () => {
    renderView({ llmCalls: [] });
    expect(screen.getByText('No LLM calls recorded for this task.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
