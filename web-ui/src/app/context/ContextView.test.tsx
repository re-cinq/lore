// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContextView, { type ContextChunk } from './ContextView';

const chunk = (over: Partial<ContextChunk> = {}): ContextChunk => ({
  id: '1',
  file_path: 'docs/readme.md',
  content_type: 'doc',
  content: 'Hello context',
  ingested_at: '2026-06-03T10:00:00Z',
  repo: 're-cinq/lore',
  metadata: null,
  ...over,
});

describe('ContextView', () => {
  it('renders a card per chunk with the repo label and a detail link', () => {
    render(
      <ContextView
        types={['doc', 'adr']}
        chunks={[
          chunk({ id: 'a', file_path: 'docs/a.md', content_type: 'doc', repo: 'o/a' }),
          chunk({ id: 'b', file_path: 'adrs/b.md', content_type: 'adr', repo: 'o/b' }),
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'docs/a.md' })).toHaveAttribute(
      'href',
      '/context/docs%2Fa.md',
    );
    expect(screen.getByText('o/a')).toBeInTheDocument();
    expect(screen.getByText('o/b')).toBeInTheDocument();
  });

  it('renders a chip per detected type only — no hardcoded runbook', () => {
    render(<ContextView types={['doc', 'pull_request']} chunks={[chunk()]} />);
    expect(screen.getByRole('link', { name: 'doc' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'pull request' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'runbook' })).toBeNull();
  });

  it('marks the selected type chip active', () => {
    render(<ContextView type="adr" types={['doc', 'adr']} chunks={[chunk()]} />);
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'adr' })).toHaveClass('active');
  });

  it('shows the unfiltered empty state when there are no chunks', () => {
    render(<ContextView types={[]} chunks={[]} />);
    expect(screen.getByText('No context chunks found.')).toBeInTheDocument();
  });

  it('shows the type-scoped empty state when a type filter yields nothing', () => {
    render(<ContextView type="spec" types={['spec']} chunks={[]} />);
    expect(screen.getByText('No context chunks found for type "spec".')).toBeInTheDocument();
  });

  it('shows a search-scoped empty state combining query and type', () => {
    render(<ContextView type="spec" q="widgets" types={['spec']} chunks={[]} />);
    expect(
      screen.getByText('No context chunks found matching “widgets” for type "spec".'),
    ).toBeInTheDocument();
  });
});
