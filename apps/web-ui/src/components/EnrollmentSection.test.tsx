// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import EnrollmentSection from './EnrollmentSection';
import type { Check } from '@/lib/enrollment';

// Icon pulls in the theme context (and window.matchMedia); it's irrelevant to
// what this component contributes, so stub it out.
vi.mock('./Icon', () => ({ default: () => null }));

const checks: Check[] = [
  { id: 'onboarded', label: 'Onboarded', status: 'pass', detail: 'since 2026-01-01' },
  { id: 'onboarding-pr', label: 'Onboarding PR merged', status: 'warn', link: { href: 'https://gh/pr/1', text: 'review & merge' } },
  { id: 'gh:.github/workflows/lore-ingest.yml', label: '.github/workflows/lore-ingest.yml on GitHub', status: 'fail', detail: 'missing', action: { kind: 'reonboard', text: 'create a PR with this file' } },
];

describe('EnrollmentSection', () => {
  it('renders the reonboard button, the link, and the pass summary when a handler is provided', () => {
    const reonboardAction = vi.fn().mockResolvedValue(undefined);
    render(<EnrollmentSection checks={checks} reonboardAction={reonboardAction} />);

    expect(screen.getByRole('button', { name: 'create a PR with this file' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'review & merge' })).toHaveAttribute('href', 'https://gh/pr/1');
    expect(screen.getByText('1/3 checks passing')).toBeInTheDocument();
  });

  it('omits the reonboard button when no handler is provided', () => {
    render(<EnrollmentSection checks={checks} />);

    expect(screen.queryByRole('button', { name: 'create a PR with this file' })).not.toBeInTheDocument();
  });
});
