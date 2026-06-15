// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import JobRunView, { JobRunRow } from './JobRunView';

const fullRun: JobRunRow = {
  id: 'run-abc-123',
  job_name: 'spec-coverage-validate',
  status: 'success',
  started_at: '2026-06-01T10:00:00.000Z',
  completed_at: '2026-06-01T10:05:00.000Z',
  result_summary: 'Validated 12 specs',
  error: null,
  log_path: 'logs/run-abc-123.txt',
};

const erroredRun: JobRunRow = {
  id: 'run-err-9',
  job_name: 'auto-merge',
  status: 'failed',
  started_at: '2026-06-02T08:00:00.000Z',
  completed_at: null,
  result_summary: null,
  error: 'boom: connection refused',
  log_path: 'logs/run-err-9.txt',
};

const inProcessRun: JobRunRow = {
  id: 'run-inproc-5',
  job_name: 'memory-lifecycle',
  status: 'running',
  started_at: '2026-06-03T12:00:00.000Z',
  completed_at: null,
  result_summary: null,
  error: null,
  log_path: null,
};

describe('JobRunView', () => {
  it('renders not found state with the requested id and back link', () => {
    render(<JobRunView id="missing-42" run={null} logs={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Job Run');
    expect(screen.getByText('Run not found: missing-42')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to analytics' })).toHaveAttribute('href', '/analytics');
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });

  it('renders job name badge, status badge with op class, and all optional fields for a full run', () => {
    render(<JobRunView id="run-abc-123" run={fullRun} logs={null} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(within(heading).getByText('spec-coverage-validate')).toBeInTheDocument();
    const statusBadge = within(heading).getByText('success');
    expect(statusBadge).toHaveClass('op-badge', 'op-success');

    expect(screen.getByText('run-abc-123')).toBeInTheDocument();
    expect(screen.getByText('Completed:')).toBeInTheDocument();
    expect(screen.getByText('Validated 12 specs')).toBeInTheDocument();
    expect(screen.getByText('logs/run-abc-123.txt')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('omits completed, summary and error rows when those fields are null', () => {
    render(<JobRunView id="run-inproc-5" run={inProcessRun} logs={null} />);
    expect(screen.queryByText('Completed:')).not.toBeInTheDocument();
    expect(screen.queryByText('Summary:')).not.toBeInTheDocument();
    expect(screen.queryByText('Error:')).not.toBeInTheDocument();
    expect(screen.queryByText('Log path:')).not.toBeInTheDocument();
  });

  it('renders the error row when the run has an error', () => {
    render(<JobRunView id="run-err-9" run={erroredRun} logs={null} />);
    expect(screen.getByText('Error:')).toBeInTheDocument();
    expect(screen.getByText('boom: connection refused')).toBeInTheDocument();
    const statusBadge = within(screen.getByRole('heading', { level: 1 })).getByText('failed');
    expect(statusBadge).toHaveClass('op-failed');
  });

  it('shows missing/unreadable message when log_path is set but logs are null', () => {
    render(<JobRunView id="run-abc-123" run={fullRun} logs={null} />);
    expect(screen.getByText('Log object missing or unreadable.')).toBeInTheDocument();
    expect(screen.queryByText(/No log_path recorded/)).not.toBeInTheDocument();
  });

  it('shows in-process message when no log_path is recorded and logs are null', () => {
    render(<JobRunView id="run-inproc-5" run={inProcessRun} logs={null} />);
    expect(
      screen.getByText('No log_path recorded for this run (in-process jobs do not yet capture per-run output).'),
    ).toBeInTheDocument();
  });

  it('renders the log output in a pre block when logs are present', () => {
    render(<JobRunView id="run-abc-123" run={fullRun} logs={'line one\nline two'} />);
    const pre = document.querySelector('pre');
    expect(pre).toBeInTheDocument();
    expect(pre).toHaveTextContent('line one line two');
    expect(screen.queryByText('Log object missing or unreadable.')).not.toBeInTheDocument();
  });
});
