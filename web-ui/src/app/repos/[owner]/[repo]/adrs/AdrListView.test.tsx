// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdrListView from './AdrListView';

describe('AdrListView', () => {
  it('renders a card per ADR summary with a Details link to the encoded detail path', () => {
    const adrs = [
      { filePath: 'adrs/ADR-016-dark-factory.md', title: 'Dark Factory', description: 'Autonomous PRs' },
      { filePath: 'adrs/ADR-015-review-reactor.md', title: 'Review Reactor', description: 'Event-driven review' },
    ];
    render(<AdrListView owner="re-cinq" repo="lore" adrs={adrs} />);

    expect(screen.getByText('Dark Factory')).toBeTruthy();
    expect(screen.getByText('Review Reactor')).toBeTruthy();

    const detailsHrefs = screen.queryAllByText('Details').map((node) => node.closest('a')?.getAttribute('href'));
    expect(detailsHrefs).toEqual([
      `/repos/re-cinq/lore/adrs/${encodeURIComponent('adrs/ADR-016-dark-factory.md')}`,
      `/repos/re-cinq/lore/adrs/${encodeURIComponent('adrs/ADR-015-review-reactor.md')}`,
    ]);
  });

  it('shows an empty-state hint when the graph holds no ADRs', () => {
    render(<AdrListView owner="re-cinq" repo="lore" adrs={[]} />);
    expect(screen.getByText(/no adrs in the graph/i)).toBeTruthy();
  });
});
