// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FailurePanel from './FailurePanel';

const repo = 're-cinq/lore';

describe('FailurePanel', () => {
  it('renders null when metadata has no error and no details (undefined fields)', () => {
    const { container } = render(<FailurePanel metadata={{}} repo={repo} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders null when error is absent and details is an empty array', () => {
    const { container } = render(<FailurePanel metadata={{ details: [] }} repo={repo} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders null when metadata itself is undefined (optional-chain guard)', () => {
    const { container } = render(
      <FailurePanel metadata={undefined as unknown as { error?: string }} repo={repo} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the Failure heading and a top-level error paragraph', () => {
    render(<FailurePanel metadata={{ error: 'boom happened' }} repo={repo} />);
    expect(screen.getByRole('heading', { name: /Failure/ })).toBeInTheDocument();
    expect(screen.getByText('boom happened')).toBeInTheDocument();
  });

  it('maps a known category code to its human label badge', () => {
    render(<FailurePanel metadata={{ error: 'x', category: 'anthropic-credit' }} repo={repo} />);
    expect(screen.getByText('Anthropic credit')).toBeInTheDocument();
  });

  it('falls back to the raw category string for an unmapped code', () => {
    render(<FailurePanel metadata={{ error: 'x', category: 'some-novel-code' }} repo={repo} />);
    expect(screen.getByText('some-novel-code')).toBeInTheDocument();
  });

  it('renders no category badge when category is absent but error is present', () => {
    const { container } = render(<FailurePanel metadata={{ error: 'just an error' }} repo={repo} />);
    expect(container.querySelector('.badge-red')).toBeNull();
  });

  it('renders the remediation hint with the "How to fix" label', () => {
    render(<FailurePanel metadata={{ error: 'x', hint: 'try topping up credits' }} repo={repo} />);
    expect(screen.getByText('How to fix:')).toBeInTheDocument();
    expect(screen.getByText('try topping up credits')).toBeInTheDocument();
  });

  it('omits the hint paragraph when no hint is provided', () => {
    render(<FailurePanel metadata={{ error: 'x' }} repo={repo} />);
    expect(screen.queryByText('How to fix:')).not.toBeInTheDocument();
  });

  it('linkifies a file path inside the top-level error via the real Linkified', () => {
    render(<FailurePanel metadata={{ error: 'see src/a.ts for context' }} repo={repo} />);
    const link = screen.getByRole('link', { name: 'src/a.ts' });
    expect(link).toHaveAttribute('href', 'https://github.com/re-cinq/lore/blob/main/src/a.ts');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders a per-step detail row with code label, its category badge, error and hint', () => {
    render(
      <FailurePanel
        metadata={{
          details: [
            {
              step: 'validate:lint',
              category: 'github-permission',
              error: 'permission denied on #7',
              hint: 'grant write scope',
            },
          ],
        }}
        repo={repo}
      />,
    );
    expect(screen.getByText('validate:lint')).toBeInTheDocument();
    expect(screen.getByText('GitHub permission')).toBeInTheDocument();
    expect(screen.getByText('grant write scope')).toBeInTheDocument();
    const issueLink = screen.getByRole('link', { name: '#7' });
    expect(issueLink).toHaveAttribute('href', 'https://github.com/re-cinq/lore/issues/7');
  });

  it('omits the per-step category badge and hint when a detail lacks them', () => {
    const { container } = render(
      <FailurePanel
        metadata={{ details: [{ step: 'build', error: 'compile failed' }] }}
        repo={repo}
      />,
    );
    expect(screen.getByText('build')).toBeInTheDocument();
    expect(screen.getByText('compile failed')).toBeInTheDocument();
    expect(container.querySelector('.badge-red')).toBeNull();
    expect(container.querySelector('.meta')).toBeNull();
  });

  it('renders multiple detail rows preserving order', () => {
    render(
      <FailurePanel
        metadata={{
          details: [
            { step: 'step-one', error: 'first failure' },
            { step: 'step-two', error: 'second failure' },
          ],
        }}
        repo={repo}
      />,
    );
    const codes = screen.getAllByText(/step-(one|two)/).map((el) => el.textContent);
    expect(codes).toEqual(['step-one', 'step-two']);
  });

  it('renders details rows even when there is no top-level error', () => {
    render(
      <FailurePanel
        metadata={{ details: [{ step: 'only-step', error: 'detail-only failure' }] }}
        repo={repo}
      />,
    );
    expect(screen.getByRole('heading', { name: /Failure/ })).toBeInTheDocument();
    expect(screen.getByText('detail-only failure')).toBeInTheDocument();
  });

  it('renders the unknown category label for the reserved unknown code', () => {
    render(<FailurePanel metadata={{ error: 'x', category: 'unknown' }} repo={repo} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
