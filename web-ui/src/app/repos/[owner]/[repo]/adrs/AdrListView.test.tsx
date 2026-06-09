// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdrListView from './AdrListView';

describe('AdrListView', () => {
  it('lists ADR paths as links to the per-repo ADR detail (encoded path)', () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={['adrs/ADR-016-dark-factory.md']} />);
    const link = screen.getByText('adrs/ADR-016-dark-factory.md').closest('a');
    expect(link?.getAttribute('href')).toBe(`/repos/re-cinq/lore/adrs/${encodeURIComponent('adrs/ADR-016-dark-factory.md')}`);
  });

  it('shows an empty-state hint when the graph holds no ADRs', () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={[]} />);
    expect(screen.getByText(/no adrs in the graph/i)).toBeTruthy();
  });
});
