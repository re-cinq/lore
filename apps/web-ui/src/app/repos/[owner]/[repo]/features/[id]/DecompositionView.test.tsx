// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DecompositionView from './DecompositionView';

describe('DecompositionView', () => {
  it('renders nothing when there are no tasks', () => {
    const { container } = render(<DecompositionView owner="o" repo="r" stories={[]} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links each story to its GitHub issue, lists tasks with status, and labels the no-story group', () => {
    const stories = [
      { storyIssue: 7, tasks: [{ specTaskId: 'T001', description: 'T001: build it', status: 'pending', phase: 1 }] },
      { storyIssue: null, tasks: [{ specTaskId: 'T002', description: 'T002: loose end', status: 'weird', phase: 0 }] },
    ];
    render(<DecompositionView owner="o" repo="r" stories={stories} total={2} />);

    expect(screen.getByRole('link', { name: /User story #7/i })).toHaveAttribute(
      'href',
      'https://github.com/o/r/issues/7',
    );
    expect(screen.getByText('T001: build it')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument(); // null-story group label
    expect(screen.getByText('weird')).toBeInTheDocument(); // unknown status → fallback color branch
  });
});
