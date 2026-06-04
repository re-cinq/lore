// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PipelineCreateView from './PipelineCreateView';

const action = vi.fn();

describe('PipelineCreateView', () => {
  it('renders the heading and the Create Task submit button', () => {
    render(<PipelineCreateView onboardedRepos={[]} createTaskAction={action} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create Task' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Task' })).toBeInTheDocument();
  });

  it('renders all four task-type options', () => {
    render(<PipelineCreateView onboardedRepos={[]} createTaskAction={action} />);
    expect(screen.getByRole('option', { name: 'General' })).toHaveValue('general');
    expect(screen.getByRole('option', { name: 'Runbook' })).toHaveValue('runbook');
    expect(screen.getByRole('option', { name: 'Implementation' })).toHaveValue('implementation');
    expect(screen.getByRole('option', { name: 'Gap Fill' })).toHaveValue('gap-fill');
  });

  it('renders a target_repo dropdown option per onboarded repo when repos exist', () => {
    const { container } = render(
      <PipelineCreateView
        onboardedRepos={[{ full_name: 're-cinq/lore' }, { full_name: 're-cinq/other' }]}
        createTaskAction={action}
      />,
    );
    const select = container.querySelector('select[name="target_repo"]');
    expect(select).toBeInTheDocument();
    expect(container.querySelector('input[name="target_repo"]')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 're-cinq/lore' })).toHaveValue('re-cinq/lore');
    expect(screen.getByRole('option', { name: 're-cinq/other' })).toHaveValue('re-cinq/other');
  });

  it('falls back to a free-text target_repo input defaulting to re-cinq/lore when no repos exist', () => {
    const { container } = render(
      <PipelineCreateView onboardedRepos={[]} createTaskAction={action} />,
    );
    expect(container.querySelector('select[name="target_repo"]')).not.toBeInTheDocument();
    expect(container.querySelector('input[name="target_repo"]')).toHaveValue('re-cinq/lore');
  });

  it('renders the immediate-priority checkbox carrying value immediate', () => {
    const { container } = render(
      <PipelineCreateView onboardedRepos={[]} createTaskAction={action} />,
    );
    const checkbox = container.querySelector('input[name="priority"]');
    expect(checkbox).toHaveAttribute('type', 'checkbox');
    expect(checkbox).toHaveAttribute('value', 'immediate');
    expect(screen.getByText('Execute immediately')).toBeInTheDocument();
    expect(
      screen.getByText('— runs on GKE now instead of waiting for local pickup'),
    ).toBeInTheDocument();
  });

  it('renders the required description textarea', () => {
    const { container } = render(
      <PipelineCreateView onboardedRepos={[]} createTaskAction={action} />,
    );
    const textarea = container.querySelector('textarea[name="description"]');
    expect(textarea).toBeRequired();
    expect(textarea).toHaveAttribute('placeholder', 'What should the agent do? Be specific...');
  });

  it('wires the form to the injected createTaskAction', () => {
    const { container } = render(
      <PipelineCreateView onboardedRepos={[]} createTaskAction={action} />,
    );
    expect(container.querySelector('form.task-form')).toBeInTheDocument();
  });
});
