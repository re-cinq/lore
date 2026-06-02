// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpecCard, { type SpecCardData } from './SpecCard';

const base = (overrides: Partial<SpecCardData> = {}): SpecCardData => ({
  spec_path: 'specs/x/spec.md',
  title: 'X',
  summary: 'short summary',
  coverage: { testable: 2, covered: 1, untestable: 1 },
  test_count: 1,
  last_linked_at: null,
  last_linked_by: null,
  ...overrides,
});

describe('SpecCard attribution subline', () => {
  beforeAll(() => {
    // Freeze time so the "Xh ago" output is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T15:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('does not render the subline when last_linked_by is null', () => {
    render(<SpecCard owner="o" repo="r" spec={base()} />);
    expect(screen.queryByText(/linked .* ago/)).toBeNull();
  });

  it('does not render the subline when last_linked_by is the cron source', () => {
    render(<SpecCard owner="o" repo="r" spec={base({
      last_linked_at: '2026-06-02T13:00:00Z',
      last_linked_by: 'cron',
    })} />);
    expect(screen.queryByText(/linked .* ago/)).toBeNull();
  });

  it('does not render the subline for the webhook source either', () => {
    render(<SpecCard owner="o" repo="r" spec={base({
      last_linked_at: '2026-06-02T13:00:00Z',
      last_linked_by: 'webhook',
    })} />);
    expect(screen.queryByText(/linked .* ago/)).toBeNull();
  });

  it('renders "linked Xh ago by {agent}" when linked_by starts with local:', () => {
    render(<SpecCard owner="o" repo="r" spec={base({
      last_linked_at: '2026-06-02T13:00:00Z',
      last_linked_by: 'local:alice',
    })} />);
    expect(screen.getByText(/linked 2h ago by alice/)).toBeInTheDocument();
    expect(screen.getByText(/\(local\)/)).toBeInTheDocument();
  });

  it('handles minute-grained recency for very recent local runs', () => {
    render(<SpecCard owner="o" repo="r" spec={base({
      last_linked_at: '2026-06-02T14:55:00Z',
      last_linked_by: 'local:bob',
    })} />);
    expect(screen.getByText(/linked 5m ago by bob/)).toBeInTheDocument();
  });

  it('falls back to "just now" for sub-minute recency', () => {
    render(<SpecCard owner="o" repo="r" spec={base({
      last_linked_at: '2026-06-02T14:59:55Z',
      last_linked_by: 'local:carol',
    })} />);
    expect(screen.getByText(/linked just now by carol/)).toBeInTheDocument();
  });
});
