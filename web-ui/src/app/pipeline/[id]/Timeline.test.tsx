// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Isolate Timeline from the real Icon, which pulls in ThemeProvider/iconify.
// Render the icon name as data-* so we can assert which icon each stage maps to.
vi.mock('@/components/Icon', () => ({
  __esModule: true,
  default: ({ name, size }: { name: string; size?: number }) => (
    <span data-testid="icon" data-icon={name} data-size={size} />
  ),
}));

import Timeline from './Timeline';

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function baseResponse(overrides: Record<string, unknown> = {}) {
  return {
    task_id: 't1',
    branch_name: 'lore/feature',
    repo: 're-cinq/lore',
    pr_number: null,
    pr_url: null,
    pr_state: null,
    commits: [],
    current_stage: null,
    ...overrides,
  };
}

function commit(overrides: Record<string, unknown> = {}) {
  return {
    sha: 'abcdef1234567890',
    stage: 'implement',
    iteration: 0,
    outcome: 'success',
    committed_at: '2026-06-04T10:00:00Z',
    duration_ms: 1500,
    summary: 'did the thing',
    ...overrides,
  };
}

// Flush the pending fetch().then() microtask chain inside React act().
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Timeline', () => {
  it('renders the loading state before the first fetch resolves', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((res) => { resolveFetch = res; })),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);

    expect(screen.getByText('Loading timeline…')).toBeInTheDocument();

    // Resolve so afterEach has no dangling promise.
    await act(async () => {
      resolveFetch(jsonResponse(baseResponse()));
    });
  });

  it('renders the error state when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText('Timeline unavailable: HTTP 503')).toBeInTheDocument();
  });

  it('renders the error state when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText('Timeline unavailable: network down')).toBeInTheDocument();
  });

  it('requests the timeline endpoint for the given task id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
    vi.stubGlobal('fetch', fetchMock);
    render(<Timeline taskId="task-42" initialStatus="done" />);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/api/pipeline/task-42/timeline');
  });

  it('renders the empty commits message when no commits and branch not deleted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(baseResponse())));
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText('Stage Timeline')).toBeInTheDocument();
    expect(screen.getByText('No stage commits yet.')).toBeInTheDocument();
  });

  it('renders the no_branch pending notice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(baseResponse({ pending: 'no_branch' }))),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(
      screen.getByText(/waiting for the supervisor to acquire its lease/),
    ).toBeInTheDocument();
  });

  it('renders the branch-deleted banner and suppresses the empty-commits message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(baseResponse({ branch_deleted: true, branch_name: 'gone/branch' })),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText(/has been deleted on the/)).toBeInTheDocument();
    expect(screen.getByText('gone/branch')).toBeInTheDocument();
    expect(screen.queryByText('No stage commits yet.')).not.toBeInTheDocument();
  });

  it('maps a known stage to its node icon and shows the success outcome pill', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(baseResponse({ commits: [commit({ stage: 'review', outcome: 'success' })] })),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText('review')).toBeInTheDocument();
    expect(screen.getByText('iter 0')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    const stageIcon = screen.getAllByTestId('icon').find((el) => el.getAttribute('data-size') === '18');
    expect(stageIcon).toHaveAttribute('data-icon', 'review');
  });

  it('falls back to the bullet icon for an unknown stage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(baseResponse({ commits: [commit({ stage: 'mystery' })] })),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    const stageIcon = screen.getAllByTestId('icon').find((el) => el.getAttribute('data-size') === '18');
    expect(stageIcon).toHaveAttribute('data-icon', 'bullet');
  });

  it('colours each outcome pill: success, changes_requested, failed, and unknown fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          baseResponse({
            commits: [
              commit({ sha: 'a000000000', outcome: 'success' }),
              commit({ sha: 'b000000000', outcome: 'changes_requested' }),
              commit({ sha: 'c000000000', outcome: 'failed' }),
              commit({ sha: 'd000000000', outcome: 'weird' }),
            ],
          }),
        ),
      ),
    );
    const { container } = render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    const pills = Array.from(container.querySelectorAll<HTMLElement>('.status-pill'));
    const colorOf = (text: string) =>
      pills.find((p) => p.textContent === text)?.style.getPropertyValue('--pill-color');

    expect(colorOf('success')).toBe('var(--success)');
    expect(colorOf('changes_requested')).toBe('var(--warning)');
    expect(colorOf('failed')).toBe('var(--danger)');
    expect(colorOf('weird')).toBe('var(--text-muted)');
  });

  it('formats every duration bucket: null, sub-second, seconds, minutes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          baseResponse({
            commits: [
              commit({ sha: 'a000000000', duration_ms: null }),
              commit({ sha: 'b000000000', duration_ms: 250 }),
              commit({ sha: 'c000000000', duration_ms: 4200 }),
              commit({ sha: 'd000000000', duration_ms: 65_000 }),
            ],
          }),
        ),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('250ms')).toBeInTheDocument();
    expect(screen.getByText('4.2s')).toBeInTheDocument();
    expect(screen.getByText('1m 5s')).toBeInTheDocument();
  });

  it('renders a commit link to GitHub when repo is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          baseResponse({
            repo: 'owner/name',
            commits: [commit({ sha: 'abc1234deadbeef' })],
          }),
        ),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://github.com/owner/name/commit/abc1234deadbeef');
    expect(link).toHaveTextContent('abc1234');
  });

  it('omits the commit link when repo is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(baseResponse({ repo: null, commits: [commit()] })),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the held-lease indicator with holder and expiry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          baseResponse({
            lease: { held: true, holder: 'pod-7', expires_at: '2026-06-04T10:05:00Z' },
          }),
        ),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText('pod-7')).toBeInTheDocument();
    expect(screen.getByText(/Lease held by/)).toBeInTheDocument();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
  });

  it('renders the held-lease indicator without an expiry when expires_at is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(baseResponse({ lease: { held: true, holder: 'pod-9' } })),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.getByText('pod-9')).toBeInTheDocument();
    expect(screen.queryByText(/expires/)).not.toBeInTheDocument();
  });

  it('hides the lease indicator when the lease is not held', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(baseResponse({ lease: { held: false, holder: 'pod-x' } })),
      ),
    );
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    expect(screen.queryByText(/Lease held by/)).not.toBeInTheDocument();
  });

  it('does not install a poll interval for a terminal status with a retrospective stage', async () => {
    // current_stage 'retrospective' keeps stillActive false even on re-run, so no
    // interval is ever installed; advancing the clock yields no further fetches.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(baseResponse({ current_stage: 'retrospective' })));
    vi.stubGlobal('fetch', fetchMock);
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    const settled = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000 * 3);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(settled);
  });

  it('polls on the 10s interval while initialStatus is active', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse({ current_stage: 'implement' })));
    vi.stubGlobal('fetch', fetchMock);
    render(<Timeline taskId="t1" initialStatus="running" />);
    await flush();

    const settled = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(settled + 1);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBe(settled + 2);
  });

  it('starts polling when the current stage is active even if initialStatus is terminal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse({ current_stage: 'validate' })));
    vi.stubGlobal('fetch', fetchMock);
    render(<Timeline taskId="t1" initialStatus="done" />);
    await flush();

    // First effect run fetched once; data.current_stage flips stillActive true,
    // re-running the effect which installs the interval.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('stops fetching after unmount (interval cleared)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse({ current_stage: 'implement' })));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<Timeline taskId="t1" initialStatus="running" />);
    await flush();

    const callsAtUnmount = fetchMock.mock.calls.length;
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000 * 5);
    });
    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });

  it('clears a prior error after a subsequent successful poll', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValue(jsonResponse(baseResponse({ current_stage: 'implement', commits: [commit()] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<Timeline taskId="t1" initialStatus="running" />);
    await flush();

    expect(screen.getByText('Timeline unavailable: HTTP 500')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(screen.getByText('Stage Timeline')).toBeInTheDocument();
    expect(screen.queryByText(/Timeline unavailable/)).not.toBeInTheDocument();
  });
});
