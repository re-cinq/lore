// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContextFilters from './ContextFilters';

describe('ContextFilters', () => {
  it('renders one chip per detected type only, in canonical order', () => {
    render(<ContextFilters basePath="/context" types={['code', 'doc']} />);
    const chips = screen.getAllByRole('link').map((a) => a.textContent);
    expect(chips).toEqual(['All', 'doc', 'code']);
    expect(screen.queryByRole('link', { name: 'runbook' })).toBeNull();
  });

  it('marks All active when no type is selected', () => {
    render(<ContextFilters basePath="/context" types={['doc']} />);
    expect(screen.getByRole('link', { name: 'All' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'doc' })).not.toHaveClass('active');
  });

  it('marks the selected type active and leaves All inactive', () => {
    render(<ContextFilters basePath="/context" types={['doc', 'spec']} activeType="spec" />);
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'spec' })).toHaveClass('active');
  });

  it('preserves the active query in every chip href', () => {
    render(<ContextFilters basePath="/context" types={['doc']} q="hello" />);
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/context?q=hello');
    expect(screen.getByRole('link', { name: 'doc' })).toHaveAttribute(
      'href',
      '/context?type=doc&q=hello',
    );
  });

  it('seeds the search box and preserves the active type via a hidden field', () => {
    const { container } = render(
      <ContextFilters basePath="/repos/o/r/context" types={['doc']} activeType="doc" q="foo" />,
    );
    const form = container.querySelector('form.search-form');
    expect(form).toHaveAttribute('action', '/repos/o/r/context');
    expect(container.querySelector<HTMLInputElement>('input[name="q"]')?.value).toEqual('foo');
    expect(container.querySelector<HTMLInputElement>('input[name="type"]')?.value).toEqual('doc');
  });

  it('omits the hidden type field when no type is active', () => {
    const { container } = render(<ContextFilters basePath="/context" types={['doc']} />);
    expect(container.querySelector('input[name="type"]')).toBeNull();
  });
});
