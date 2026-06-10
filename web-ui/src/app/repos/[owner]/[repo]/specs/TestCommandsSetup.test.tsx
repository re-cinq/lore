// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TestCommandsSetup from './TestCommandsSetup';
import { TEST_COMMAND_SETUP_PROMPT } from '@/lib/test-command-setup-prompt';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestCommandsSetup', () => {
  it('renders the setup prompt text into the DOM', () => {
    render(<TestCommandsSetup />);
    expect(
      screen.getByText(/Write `\.lore\/test-commands\.yml`/),
    ).toBeInTheDocument();
  });

  it('renders a "Set up test commands" heading', () => {
    render(<TestCommandsSetup />);
    expect(
      screen.getByRole('heading', { name: /set up test commands/i }),
    ).toBeInTheDocument();
  });

  it('copies the full setup prompt to the clipboard on Copy click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    render(<TestCommandsSetup />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(TEST_COMMAND_SETUP_PROMPT),
    );
  });
});
