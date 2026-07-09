// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const formStatus = vi.fn<() => { pending: boolean }>(() => ({ pending: false }));
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, useFormStatus: () => formStatus() };
});

import { SubmitButton } from './SubmitButton';

describe('SubmitButton', () => {
  it('shows the idle label and stays enabled when the form is not pending', () => {
    formStatus.mockReturnValue({ pending: false });
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('swaps to the pending label and disables while the form is pending', () => {
    formStatus.mockReturnValue({ pending: true });
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the children as the label when no pendingLabel is given', () => {
    formStatus.mockReturnValue({ pending: true });
    render(<SubmitButton>Go</SubmitButton>);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
  });
});
