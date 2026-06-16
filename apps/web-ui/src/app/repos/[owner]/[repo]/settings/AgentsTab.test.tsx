// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AgentsTab from './AgentsTab';
import type { AgentDefinition } from '@/lib/agents-mirror';

const noop = vi.fn(async () => ({}));
const agent: AgentDefinition = {
  name: 'general',
  model: 'claude-sonnet-4-6',
  timeout_minutes: 30,
  prompt: 'base',
  image: null,
  execution_mode: 'claude-code',
  review_required: true,
  project_id: null,
};

describe('AgentsTab', () => {
  it('renders one card per agent', () => {
    const { container } = render(
      <AgentsTab repo="o/r" agents={[agent, { ...agent, name: 'review' }]} saveAction={noop} deleteAction={noop} />,
    );
    expect(container.querySelectorAll('select[name="model_select"]').length).toBe(2);
  });

  it('reveals a blank new-agent card when "+ Add agent" is clicked', () => {
    const { container, getByRole } = render(
      <AgentsTab repo="o/r" agents={[agent]} saveAction={noop} deleteAction={noop} />,
    );
    expect(container.querySelector('input[name="name_input"]')).toBeNull();

    fireEvent.click(getByRole('button', { name: '+ Add agent' }));

    expect(container.querySelector('input[name="name_input"]')).not.toBeNull();
  });
});
