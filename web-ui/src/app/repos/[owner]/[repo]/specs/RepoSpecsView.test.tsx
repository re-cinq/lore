// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RepoSpecsView from './RepoSpecsView';
import { type SpecCardData } from './SpecCard';

const card = (over: Partial<SpecCardData>): SpecCardData => ({
  spec_path: 'specs/a/spec.md',
  title: 'Spec A',
  summary: 'A summary.',
  coverage: { testable: 2, covered: 1, untestable: 0 },
  ...over,
});

const noop = vi.fn();

describe('RepoSpecsView', () => {
  it('renders one card per spec', () => {
    render(
      <RepoSpecsView
        owner="re-cinq"
        repo="lore"
        specs={[card({ title: 'Spec A' }), card({ spec_path: 'specs/b/spec.md', title: 'Spec B' })]}
        addSpecAction={noop}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Spec A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Spec B' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no specs', () => {
    render(<RepoSpecsView owner="re-cinq" repo="lore" specs={[]} addSpecAction={noop} />);
    expect(screen.getByText('No specs found for this repo.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('wires the Add-Spec form to the injected action with hidden owner/repo', () => {
    const { container } = render(
      <RepoSpecsView owner="re-cinq" repo="lore" specs={[]} addSpecAction={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Add Spec' })).toBeInTheDocument();
    expect(container.querySelector('input[name="owner"]')).toHaveValue('re-cinq');
    expect(container.querySelector('input[name="repo"]')).toHaveValue('lore');
  });
});
