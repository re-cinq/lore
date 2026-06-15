// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GapsView, { type GapMemoryRow, type ZeroResultSearchRow } from './GapsView';

const memory = (over: Partial<GapMemoryRow> = {}): GapMemoryRow => ({
  key: 'gap/2026-06-03',
  value: 'Missing runbook for the lease reaper job.',
  created_at: '2026-06-03T10:00:00Z',
  ...over,
});

const search = (over: Partial<ZeroResultSearchRow> = {}): ZeroResultSearchRow => ({
  memory_key: 'how to rotate db credentials',
  metadata: { result_count: '0', team: 'platform' },
  created_at: '2026-06-03T09:00:00Z',
  ...over,
});

describe('GapsView', () => {
  it('renders the global-view note linking to Repositories and the draft-PR GitHub link', () => {
    render(<GapsView gapMemories={[]} zeroResultSearches={[]} />);
    expect(screen.getByText('Gap Detection')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Repositories' })).toHaveAttribute('href', '/');
    expect(
      screen.getByRole('link', { name: 'View context-gap-draft PRs on GitHub →' }),
    ).toHaveAttribute('href', 'https://github.com/re-cinq/lore/pulls?q=label:context-gap-draft');
  });

  it('renders a card per gap-detection finding with its key and raw value', () => {
    render(
      <GapsView
        gapMemories={[
          memory({ key: 'gap/alpha', value: 'Alpha finding text.' }),
          memory({ key: 'gap/beta', value: 'Beta finding text.' }),
        ]}
        zeroResultSearches={[]}
      />,
    );
    expect(screen.getByText('gap/alpha')).toBeInTheDocument();
    expect(screen.getByText('Alpha finding text.')).toBeInTheDocument();
    expect(screen.getByText('gap/beta')).toBeInTheDocument();
    expect(screen.getByText('Beta finding text.')).toBeInTheDocument();
  });

  it('shows the empty findings message when there are no gap memories', () => {
    render(<GapsView gapMemories={[]} zeroResultSearches={[search()]} />);
    expect(screen.getByText('No findings from the gap detection agent yet.')).toBeInTheDocument();
  });

  it('renders a table row per zero-result search with its query and serialized metadata', () => {
    render(
      <GapsView
        gapMemories={[]}
        zeroResultSearches={[
          search({ memory_key: 'rotate db creds', metadata: { result_count: '0' } }),
        ]}
      />,
    );
    expect(screen.getByText('Query')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('rotate db creds')).toBeInTheDocument();
    expect(screen.getByText(JSON.stringify({ result_count: '0' }))).toBeInTheDocument();
  });

  it('shows the empty zero-result message when there are no recorded searches', () => {
    render(<GapsView gapMemories={[memory()]} zeroResultSearches={[]} />);
    expect(screen.getByText('No zero-result searches recorded.')).toBeInTheDocument();
  });
});
