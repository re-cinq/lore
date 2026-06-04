// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AssembledContextView, {
  TOKEN_BUDGET,
  type AssembledResult,
  type AssembledContextViewProps,
} from './AssembledContextView';

const result = (over: Partial<AssembledResult> = {}): AssembledResult => ({
  text: 'Assembled **context** body.',
  sections: [
    { header: 'Conventions', tokens: 4000, truncated: false },
    { header: 'Agent Memory', tokens: 1000, truncated: true },
  ],
  ...over,
});

const baseProps = (over: Partial<AssembledContextViewProps> = {}): AssembledContextViewProps => ({
  query: 'add auth',
  template: 'implementation',
  templates: ['default', 'implementation', 'review', 'research'],
  result: null,
  loading: false,
  error: null,
  onQueryChange: vi.fn(),
  onTemplateChange: vi.fn(),
  onSubmit: vi.fn(),
  ...over,
});

function submitForm(container: HTMLElement) {
  const form = container.querySelector('form');
  if (!form) throw new Error('no form');
  fireEvent.submit(form);
}

describe('AssembledContextView', () => {
  it('renders the heading and the help popover trigger', () => {
    render(<AssembledContextView {...baseProps()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Assembled Context' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What sessions receive' })).toBeInTheDocument();
  });

  it('renders one template option per templates entry, with the current one selected', () => {
    render(<AssembledContextView {...baseProps({ template: 'review' })} />);
    const select = screen.getByLabelText('Template') as HTMLSelectElement;
    expect(select.value).toBe('review');
    expect(screen.getByRole('option', { name: 'research' })).toBeInTheDocument();
    expect(select.querySelectorAll('option')).toHaveLength(4);
  });

  it('pushes query edits up via onQueryChange', () => {
    const onQueryChange = vi.fn();
    render(<AssembledContextView {...baseProps({ query: '', onQueryChange })} />);
    fireEvent.change(screen.getByPlaceholderText(/Describe the task/), { target: { value: 'fix bug' } });
    expect(onQueryChange).toHaveBeenCalledWith('fix bug');
  });

  it('pushes template edits up via onTemplateChange', () => {
    const onTemplateChange = vi.fn();
    render(<AssembledContextView {...baseProps({ onTemplateChange })} />);
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'research' } });
    expect(onTemplateChange).toHaveBeenCalledWith('research');
  });

  it('disables submit when the query is blank or whitespace only', () => {
    render(<AssembledContextView {...baseProps({ query: '   ' })} />);
    expect(screen.getByRole('button', { name: 'Assemble' })).toBeDisabled();
  });

  it('disables submit while loading', () => {
    render(<AssembledContextView {...baseProps({ loading: true })} />);
    expect(screen.getByRole('button', { name: 'Assembling…' })).toBeDisabled();
  });

  it('fires onSubmit when the form is submitted with a non-empty query', () => {
    const onSubmit = vi.fn();
    const { container } = render(<AssembledContextView {...baseProps({ onSubmit })} />);
    submitForm(container);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not fire onSubmit when the form is submitted with a blank query', () => {
    const onSubmit = vi.fn();
    const { container } = render(<AssembledContextView {...baseProps({ query: '  ', onSubmit })} />);
    submitForm(container);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders the loading state', () => {
    render(<AssembledContextView {...baseProps({ loading: true })} />);
    expect(screen.getByText('Assembling context…')).toBeInTheDocument();
  });

  it('renders the error state with the message', () => {
    render(<AssembledContextView {...baseProps({ error: 'HTTP 500' })} />);
    expect(screen.getByText('Context unavailable: HTTP 500')).toBeInTheDocument();
  });

  it('renders the empty state when a result has null text', () => {
    render(<AssembledContextView {...baseProps({ result: { text: null, sections: [] } })} />);
    expect(
      screen.getByText('No context assembled — the repo may not be onboarded or ingested yet.'),
    ).toBeInTheDocument();
  });

  it('renders the total-vs-budget line summing the section tokens', () => {
    render(<AssembledContextView {...baseProps({ result: result() })} />);
    expect(screen.getByText(`5000 / ${TOKEN_BUDGET} tokens`)).toBeInTheDocument();
  });

  it('renders a row per section with its header and token count', () => {
    render(<AssembledContextView {...baseProps({ result: result() })} />);
    expect(screen.getByText('Conventions')).toBeInTheDocument();
    expect(screen.getByText('Agent Memory')).toBeInTheDocument();
    expect(screen.getByText('4000 tokens')).toBeInTheDocument();
    expect(screen.getByText('1000 tokens')).toBeInTheDocument();
  });

  it('shows the truncated badge only on truncated sections', () => {
    render(<AssembledContextView {...baseProps({ result: result() })} />);
    expect(screen.getAllByText('truncated', { selector: 'span.badge' })).toHaveLength(1);
  });

  it('sizes each section bar proportionally to the token budget, clamped at 100%', () => {
    const { container } = render(
      <AssembledContextView
        {...baseProps({
          result: {
            text: 'x',
            sections: [
              { header: 'Half', tokens: 4000, truncated: false },
              { header: 'Over', tokens: 12000, truncated: false },
            ],
          },
        })}
      />,
    );
    const bars = Array.from(container.querySelectorAll<HTMLElement>('[data-token-bar]'));
    expect(bars[0].style.width).toBe('50%');
    expect(bars[1].style.width).toBe('100%');
  });

  it('renders the assembled text as formatted markdown (heading, bold, blockquote)', () => {
    render(
      <AssembledContextView
        {...baseProps({ result: result({ text: '## Section\n\n> **Heads up** stale' }) })}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
    expect(screen.getByText('Heads up', { selector: 'strong' })).toBeInTheDocument();
  });

  it('renders the breakdown without crashing when sections are absent', () => {
    render(<AssembledContextView {...baseProps({ result: { text: 'only text' } })} />);
    expect(screen.getByText(`0 / ${TOKEN_BUDGET} tokens`)).toBeInTheDocument();
  });
});
