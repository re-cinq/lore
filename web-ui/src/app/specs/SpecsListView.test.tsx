// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpecsListView, { type SpecListItem } from './SpecsListView';

const item = (over: Partial<SpecListItem>): SpecListItem => ({
  file_path: 'specs/a/spec.md',
  repo: 're-cinq/lore',
  ingested_at: '2026-06-03T10:00:00Z',
  excerpt: 'An excerpt',
  ...over,
});

describe('SpecsListView', () => {
  it('renders a card per spec and a per-repo filter button with its count', () => {
    render(
      <SpecsListView
        repos={[{ repo: 're-cinq/lore', count: 2 }]}
        specs={[item({ file_path: 'specs/a/spec.md' }), item({ file_path: 'specs/b/spec.md' })]}
      />,
    );
    expect(screen.getByText('specs/a/spec.md')).toBeInTheDocument();
    expect(screen.getByText('specs/b/spec.md')).toBeInTheDocument();
    expect(screen.getByText('re-cinq/lore (2)')).toBeInTheDocument();
    expect(screen.getByText('2 specs')).toBeInTheDocument();
  });

  it('marks the active repo filter and scopes the count line', () => {
    render(
      <SpecsListView
        activeRepo="re-cinq/lore"
        repos={[{ repo: 're-cinq/lore', count: 1 }]}
        specs={[item({})]}
      />,
    );
    expect(screen.getByText('All repos')).not.toHaveClass('active');
    expect(screen.getByText('re-cinq/lore (1)')).toHaveClass('active');
    expect(screen.getByText('1 spec in "re-cinq/lore"')).toBeInTheDocument();
  });

  it('shows the empty state when there are no specs', () => {
    render(<SpecsListView repos={[]} specs={[]} />);
    expect(screen.getByText('No specs ingested yet.')).toBeInTheDocument();
  });
});
