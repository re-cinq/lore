import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeStatus, isGitHubConfigured } from './github';

const open = { merged: false, state: 'open' as const };

describe('computeStatus', () => {
  it('returns merged when the PR is merged', () => {
    expect(computeStatus({ merged: true, state: 'closed' }, [], [])).toBe('merged');
  });

  it('returns closed when the PR is closed without merge', () => {
    expect(computeStatus({ merged: false, state: 'closed' }, [], [])).toBe('closed');
  });

  it('returns draft when the open PR is a draft', () => {
    expect(computeStatus({ ...open, draft: true }, [], [])).toBe('draft');
  });

  it('returns checks-failing when a check concluded failure', () => {
    expect(computeStatus(open, [{ conclusion: 'failure' }], [])).toBe('checks-failing');
  });

  it('returns checks-failing when a check timed out', () => {
    expect(computeStatus(open, [{ conclusion: 'timed_out' }], [])).toBe('checks-failing');
  });

  it('returns changes-requested when a review requested changes', () => {
    expect(computeStatus(open, [{ conclusion: 'success' }], [{ state: 'CHANGES_REQUESTED' }]))
      .toBe('changes-requested');
  });

  it('returns approved when approved and every check is success/skipped/null', () => {
    expect(
      computeStatus(
        open,
        [{ conclusion: 'success' }, { conclusion: 'skipped' }, { conclusion: null }],
        [{ state: 'APPROVED' }],
      ),
    ).toBe('approved');
  });

  it('returns open when approved but a check is still pending', () => {
    expect(computeStatus(open, [{ conclusion: 'action_required' }], [{ state: 'APPROVED' }]))
      .toBe('open');
  });

  it('returns open when there are no checks and no reviews', () => {
    expect(computeStatus(open, [], [])).toBe('open');
  });

  it('returns checks-failing over changes-requested when both apply', () => {
    expect(
      computeStatus(open, [{ conclusion: 'failure' }], [{ state: 'CHANGES_REQUESTED' }]),
    ).toBe('checks-failing');
  });
});

describe('isGitHubConfigured', () => {
  const keys = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    keys.forEach(k => delete process.env[k]);
  });

  afterEach(() => {
    keys.forEach(k => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it('returns true when all three GitHub App vars are set', () => {
    keys.forEach(k => (process.env[k] = 'x'));
    expect(isGitHubConfigured()).toBe(true);
  });

  it('returns false when the installation id is missing', () => {
    process.env.GITHUB_APP_ID = 'x';
    process.env.GITHUB_APP_PRIVATE_KEY = 'x';
    expect(isGitHubConfigured()).toBe(false);
  });

  it('returns false when no vars are set', () => {
    expect(isGitHubConfigured()).toBe(false);
  });
});
