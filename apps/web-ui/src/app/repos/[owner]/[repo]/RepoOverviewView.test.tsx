// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import RepoOverviewView, { type RecentTask } from './RepoOverviewView';
import { type Check } from '@/lib/enrollment';

// EnrollmentSection (rendered as-is by the View) pulls in Icon, which calls
// useTheme() and throws without a ThemeProvider. Stub the icon leaf so the
// View's composition is the subject under test; EnrollmentSection's own markup
// (incl. the reonboard button) still renders.
vi.mock('@/components/Icon', () => ({ default: () => null }));

const action = vi.fn();

const checks: Check[] = [
  { id: 'onboarded', label: 'Onboarded', status: 'pass', detail: 'today' },
  {
    id: 'ingest-workflow',
    label: 'Ingest workflow',
    status: 'fail',
    action: { kind: 'reonboard', text: 'create a PR with this file' },
  },
  {
    id: 'webhook',
    label: 'GitHub webhook → Floor',
    status: 'warn',
    detail: 'last delivery 401 — secret mismatch; re-set up',
    action: { kind: 'setup-webhook', text: 'set up' },
  },
];

const task = (over: Partial<RecentTask>): RecentTask => ({
  id: 1,
  description: 'Implement the widget',
  status: 'completed',
  pr_url: 'https://github.com/re-cinq/lore/pull/7',
  created_at: '2026-06-01T10:00:00.000Z',
  ...over,
});

const baseProps = {
  owner: 're-cinq',
  repo: 'lore',
  readme: null,
  enrollmentChecks: checks,
  darkFactoryEnabled: false,
  trustLevel: 'implementation',
  darkTasksWeek: 0,
  autoMergedWeek: 0,
  escalationsWeek: 0,
  recentTasks: [] as RecentTask[],
  reonboardAction: action,
  setupWebhookAction: action,
};

describe('RepoOverviewView', () => {
  it('renders the readme box when a readme is provided', () => {
    render(
      <RepoOverviewView
        {...baseProps}
        readme={{ markdown: '# Hello Lore', rawBaseUrl: 'https://raw/', htmlUrl: 'https://html/' }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Hello Lore' })).toBeInTheDocument();
  });

  it('omits the readme box when readme is null', () => {
    render(<RepoOverviewView {...baseProps} readme={null} />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('renders the enrollment section and wires the reonboard + webhook action buttons', () => {
    render(<RepoOverviewView {...baseProps} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Enrollment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'create a PR with this file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set up' })).toBeInTheDocument();
  });

  it('shows Off (legacy) mode and links Dark Factory settings to the repo settings page', () => {
    render(<RepoOverviewView {...baseProps} darkFactoryEnabled={false} trustLevel="docs" />);
    const card = screen.getByRole('heading', { level: 3, name: 'Dark Factory' }).closest('.spec-card') as HTMLElement;
    expect(within(card).getByText('Off (legacy)')).toBeInTheDocument();
    expect(within(card).getByText('docs')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'configure →' })).toHaveAttribute(
      'href',
      '/repos/re-cinq/lore/settings',
    );
  });

  it('shows Enabled mode and the weekly counters when dark factory is on', () => {
    render(
      <RepoOverviewView
        {...baseProps}
        darkFactoryEnabled
        trustLevel="full"
        darkTasksWeek={12}
        autoMergedWeek={3}
        escalationsWeek={2}
      />,
    );
    const card = screen.getByRole('heading', { level: 3, name: 'Dark Factory' }).closest('.spec-card') as HTMLElement;
    expect(within(card).getByText('Enabled')).toBeInTheDocument();
    expect(within(card).getByText('full')).toBeInTheDocument();
    expect(within(card).getByText('12')).toBeInTheDocument();
    expect(within(card).getByText('3')).toBeInTheDocument();
    expect(within(card).getByText('2')).toBeInTheDocument();
  });

  it('renders a row per recent task with a PR link and a pipeline link', () => {
    render(
      <RepoOverviewView
        {...baseProps}
        recentTasks={[
          task({ id: 1, description: 'Implement the widget', status: 'completed' }),
          task({ id: 2, description: 'Fix the gadget', status: 'running', pr_url: null }),
        ]}
      />,
    );
    expect(screen.getByText('Implement the widget...')).toBeInTheDocument();
    const completed = screen.getByText('completed');
    expect(completed).toHaveClass('op-badge', 'op-completed');
    expect(screen.getByRole('link', { name: 'Implement the widget...' })).toHaveAttribute(
      'href',
      '/assembly-lines/1',
    );
    expect(screen.getByRole('link', { name: 'PR' })).toHaveAttribute(
      'href',
      'https://github.com/re-cinq/lore/pull/7',
    );
    // Second task has no PR — renders the em-dash placeholder.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('truncates long task descriptions to 60 chars with an ellipsis', () => {
    const long = 'x'.repeat(80);
    render(<RepoOverviewView {...baseProps} recentTasks={[task({ description: long })]} />);
    expect(screen.getByText(`${'x'.repeat(60)}...`)).toBeInTheDocument();
  });

  it('shows the empty-tasks state with a create link when there are no tasks', () => {
    render(<RepoOverviewView {...baseProps} recentTasks={[]} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute(
      'href',
      '/repos/re-cinq/lore/tasks',
    );
  });
});
