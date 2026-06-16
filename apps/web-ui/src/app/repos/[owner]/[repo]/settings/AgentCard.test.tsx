// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AgentCard from './AgentCard';
import type { AgentDefinition } from '@/lib/agents-mirror';

const noop = vi.fn(async () => ({}));
const agent: AgentDefinition = {
  name: 'general',
  model: 'claude-sonnet-4-6',
  timeout_minutes: 30,
  prompt: 'base prompt',
  image: null,
  execution_mode: 'claude-code',
  review_required: true,
  project_id: null, // inherited
};

describe('AgentCard', () => {
  it('reveals the custom model input only when Custom… is selected', () => {
    const { container } = render(<AgentCard repo="o/r" agent={agent} saveAction={noop} deleteAction={noop} />);
    expect(container.querySelector('input[name="model_custom"]')).toBeNull();

    fireEvent.change(container.querySelector('select[name="model_select"]')!, { target: { value: '__custom__' } });
    expect(container.querySelector('input[name="model_custom"]')).not.toBeNull();
  });

  it('leaves an inherited prompt empty with the base as placeholder', () => {
    const { container } = render(<AgentCard repo="o/r" agent={agent} saveAction={noop} deleteAction={noop} />);
    const ta = container.querySelector('textarea[name="prompt"]') as HTMLTextAreaElement;
    expect(ta.value).toBe('');
    expect(ta.placeholder).toBe('base prompt');
  });

  it('starts on Custom… when the model is not in the curated list', () => {
    const { container } = render(
      <AgentCard repo="o/r" agent={{ ...agent, model: 'my-custom-model', project_id: 'x' }} saveAction={noop} deleteAction={noop} />,
    );
    expect((container.querySelector('select[name="model_select"]') as HTMLSelectElement).value).toBe('__custom__');
    expect((container.querySelector('input[name="model_custom"]') as HTMLInputElement).value).toBe('my-custom-model');
  });

  it('omits the reset-to-default form on a new agent', () => {
    const { container } = render(
      <AgentCard repo="o/r" agent={{ ...agent, name: '', project_id: '' }} saveAction={noop} deleteAction={noop} isNew />,
    );
    expect(container.querySelector('input[name="name_input"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Reset to org default');
  });
});
