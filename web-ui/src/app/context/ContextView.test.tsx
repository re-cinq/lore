// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContextView, { type ContextChunk } from './ContextView';

const chunk = (over: Partial<ContextChunk>): ContextChunk => ({
  id: '1',
  file_path: 'docs/readme.md',
  content_type: 'doc',
  content: 'Hello context',
  ingested_at: '2026-06-03T10:00:00Z',
  ...over,
});

describe('ContextView', () => {
  it('renders a card per chunk with path, type badge and truncated content', () => {
    render(
      <ContextView
        chunks={[
          chunk({ id: 'a', file_path: 'docs/a.md', content_type: 'doc', content: 'First' }),
          chunk({ id: 'b', file_path: 'adrs/b.md', content_type: 'adr', content: 'Second' }),
        ]}
      />,
    );
    expect(screen.getByText('docs/a.md')).toBeInTheDocument();
    expect(screen.getByText('adrs/b.md')).toBeInTheDocument();
    expect(screen.getByText('doc', { selector: 'span.badge' })).toBeInTheDocument();
    expect(screen.getByText('adr', { selector: 'span.badge' })).toBeInTheDocument();
    expect(screen.getByText('First...')).toBeInTheDocument();
    expect(screen.getByText('Second...')).toBeInTheDocument();
  });

  it('marks All active and every type filter link present when no type is selected', () => {
    render(<ContextView chunks={[chunk({})]} />);
    expect(screen.getByText('All')).toHaveClass('active');
    for (const t of ['doc', 'adr', 'spec', 'code', 'runbook']) {
      const link = screen.getByRole('link', { name: t });
      expect(link).toHaveAttribute('href', `/context?type=${t}`);
      expect(link).not.toHaveClass('active');
    }
  });

  it('marks the selected type active and leaves All inactive', () => {
    render(<ContextView type="adr" chunks={[chunk({})]} />);
    expect(screen.getByText('All')).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'adr' })).toHaveClass('active');
  });

  it('shows the unfiltered empty state when there are no chunks and no type', () => {
    render(<ContextView chunks={[]} />);
    expect(screen.getByText('No context chunks found.')).toBeInTheDocument();
  });

  it('shows the type-scoped empty state when there are no chunks for a type', () => {
    render(<ContextView type="spec" chunks={[]} />);
    expect(screen.getByText('No context chunks found for type "spec".')).toBeInTheDocument();
  });
});
