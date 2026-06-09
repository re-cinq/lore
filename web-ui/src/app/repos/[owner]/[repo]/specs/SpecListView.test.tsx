// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpecListView from './SpecListView';

describe('SpecListView', () => {
  it('lists spec paths as links to the per-repo detail page (encoded path)', () => {
    render(<SpecListView owner="re-cinq" repo="lore" specs={['specs/auth/spec.md', '.specify/spec.md']} />);
    const link = screen.getByText('specs/auth/spec.md').closest('a');
    expect(link?.getAttribute('href')).toBe(`/repos/re-cinq/lore/specs/${encodeURIComponent('specs/auth/spec.md')}`);
  });

  it('shows an empty-state hint when the graph holds no specs', () => {
    render(<SpecListView owner="re-cinq" repo="lore" specs={[]} />);
    expect(screen.getByText(/no specs in the graph/i)).toBeTruthy();
  });
});
