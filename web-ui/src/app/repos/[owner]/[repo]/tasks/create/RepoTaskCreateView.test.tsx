// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RepoTaskCreateView from './RepoTaskCreateView';

const action = vi.fn();

describe('RepoTaskCreateView', () => {
  it('renders the heading with the full repo name', () => {
    render(<RepoTaskCreateView fullName="re-cinq/lore" createTaskAction={action} />);
    expect(screen.getByRole('heading', { level: 2, name: 'New Task for re-cinq/lore' })).toBeInTheDocument();
  });

  it('wires the create-task form with a hidden target_repo carrying the full name', () => {
    const { container } = render(
      <RepoTaskCreateView fullName="re-cinq/lore" createTaskAction={action} />,
    );
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeInTheDocument();
    expect(container.querySelector('input[name="target_repo"]')).toHaveValue('re-cinq/lore');
  });

  it('renders every task-type option', () => {
    render(<RepoTaskCreateView fullName="re-cinq/lore" createTaskAction={action} />);
    expect(screen.getByRole('option', { name: 'Feature Request (PM intent → spec)' })).toHaveValue('feature-request');
    expect(screen.getByRole('option', { name: 'General' })).toHaveValue('general');
    expect(screen.getByRole('option', { name: 'Runbook' })).toHaveValue('runbook');
    expect(screen.getByRole('option', { name: 'Implementation' })).toHaveValue('implementation');
    expect(screen.getByRole('option', { name: 'Gap Fill' })).toHaveValue('gap-fill');
  });

  it('renders the description textarea and the immediate-priority checkbox', () => {
    render(<RepoTaskCreateView fullName="acme/widgets" createTaskAction={action} />);
    expect(
      screen.getByPlaceholderText(
        "Describe what you want built. Plain language is fine — the agent will translate it into a proper spec following this repo's conventions.",
      ),
    ).toBeInTheDocument();
    const priority = screen.getByRole('checkbox');
    expect(priority).toHaveAttribute('name', 'priority');
    expect(priority).toHaveAttribute('value', 'immediate');
    expect(screen.getByText('Execute immediately')).toBeInTheDocument();
    expect(
      screen.getByText('— runs on GKE now instead of waiting for local pickup'),
    ).toBeInTheDocument();
  });
});
