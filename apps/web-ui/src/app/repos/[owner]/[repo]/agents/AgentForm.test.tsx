// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AgentForm from './AgentForm';
import type { AgentDefinition } from '@/lib/agents-mirror';

const noop = vi.fn(async () => ({}));
const agent: AgentDefinition = {
  name: 'general', model: 'claude-sonnet-4-6', timeout_minutes: 30, prompt: 'base prompt',
  image: null, execution_mode: 'claude-code', review_required: true, project_id: null,
};

describe('AgentForm', () => {
  it('shows an editable name input in create mode', () => {
    const { container } = render(<AgentForm repo="re-cinq/lore" agent={null} action={noop} isNew />);
    const nameInput = container.querySelector('input[name="name_input"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.disabled).toBe(false);
  });

  it('locks the name on edit and prefills the model', () => {
    const { container } = render(<AgentForm repo="re-cinq/lore" agent={agent} action={noop} isNew={false} />);
    expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('general');
    expect((container.querySelector('select[name="model_select"]') as HTMLSelectElement).value).toBe('claude-sonnet-4-6');
  });

  it('reveals the custom model input only when Custom… is chosen', () => {
    const { container } = render(<AgentForm repo="re-cinq/lore" agent={agent} action={noop} isNew={false} />);
    expect(container.querySelector('input[name="model_custom"]')).toBeNull();
    fireEvent.change(container.querySelector('select[name="model_select"]')!, { target: { value: '__custom__' } });
    expect(container.querySelector('input[name="model_custom"]')).not.toBeNull();
  });

  it('starts on Custom… when the model is not in the curated list', () => {
    const { container } = render(
      <AgentForm repo="re-cinq/lore" agent={{ ...agent, model: 'my-model' }} action={noop} isNew={false} />,
    );
    expect((container.querySelector('select[name="model_select"]') as HTMLSelectElement).value).toBe('__custom__');
    expect((container.querySelector('input[name="model_custom"]') as HTMLInputElement).value).toBe('my-model');
  });

  it('surfaces an error returned by the action', async () => {
    const failing = vi.fn(async () => ({ error: 'boom' }));
    const { container, findByText } = render(<AgentForm repo="re-cinq/lore" agent={agent} action={failing} isNew={false} />);
    fireEvent.submit(container.querySelector('form')!);
    expect(await findByText('boom')).toBeInTheDocument();
  });
});
