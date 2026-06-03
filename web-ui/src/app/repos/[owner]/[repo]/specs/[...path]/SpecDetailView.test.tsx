// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpecDetailView, { type SpecDetailData } from './SpecDetailView';

const spec: SpecDetailData = {
  title: 'Dark Factory Mode',
  content: 'Auto-merge runs after the retrospective stage.\n',
  statements: [],
  counts: { testable: 4, covered: 1, untestable: 2 },
};

describe('SpecDetailView', () => {
  it('renders the title, file path and coverage when the spec exists', () => {
    render(
      <SpecDetailView
        fullName="re-cinq/lore"
        filePath="specs/6-dark-factory/spec.md"
        specsLink="/repos/re-cinq/lore/specs"
        spec={spec}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Dark Factory Mode' })).toBeInTheDocument();
    expect(screen.getByText('specs/6-dark-factory/spec.md')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders a Not Found state when the spec is absent', () => {
    render(
      <SpecDetailView
        fullName="re-cinq/lore"
        filePath="specs/missing/spec.md"
        specsLink="/repos/re-cinq/lore/specs"
        spec={null}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Not Found' })).toBeInTheDocument();
    expect(screen.getByText(/No spec found at/)).toHaveTextContent('specs/missing/spec.md');
  });
});
