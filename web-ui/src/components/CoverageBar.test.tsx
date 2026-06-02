// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoverageBar from './CoverageBar';

describe('CoverageBar', () => {
  it('caption headline is tested / (tested + untested), narrative excluded', () => {
    render(<CoverageBar coverage={{ testable: 4, covered: 3, untestable: 10 }} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders three segments whose widths sum to 100% of all statements', () => {
    const { container } = render(<CoverageBar coverage={{ testable: 4, covered: 1, untestable: 1 }} />);
    const widths = Array.from(container.querySelectorAll<HTMLElement>('span[style*="width"]'))
      .map((el) => parseFloat(el.style.width));
    const sum = widths.reduce((a, b) => a + b, 0);
    expect(Math.round(sum)).toBe(100);
  });

  it('includes non-colour cues (icon + screen-reader label) per segment', () => {
    render(<CoverageBar coverage={{ testable: 2, covered: 1, untestable: 1 }} />);
    expect(screen.getByText('tested')).toBeInTheDocument();
    expect(screen.getByText('untested')).toBeInTheDocument();
    expect(screen.getByText('narrative')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
  });

  it('renders the empty state when no statements have been segmented', () => {
    render(<CoverageBar coverage={{ testable: 0, covered: 0, untestable: 0 }} />);
    expect(screen.getByText('no statements segmented yet')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'No testable statements' })).toBeInTheDocument();
  });

  it('shows 100% when every testable statement is covered', () => {
    render(<CoverageBar coverage={{ testable: 3, covered: 3, untestable: 2 }} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows 0% when no testable statement is covered', () => {
    render(<CoverageBar coverage={{ testable: 2, covered: 0, untestable: 0 }} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('shows em-dash when no testable statements exist but narratives do (denominator 0)', () => {
    render(<CoverageBar coverage={{ testable: 0, covered: 0, untestable: 3 }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
