// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import RepoContextView, { type RepoContextChunk } from './RepoContextView';

const chunk = (over: Partial<RepoContextChunk> = {}): RepoContextChunk => ({
  id: '1',
  file_path: 'docs/readme.md',
  content_type: 'doc',
  content: 'Hello context',
  ingested_at: '2026-06-03T10:00:00Z',
  metadata: null,
  ...over,
});

describe('RepoContextView', () => {
  it('renders the chunk count line from the chunks length', () => {
    render(
      <RepoContextView
        owner="o"
        repo="r"
        types={['doc']}
        chunks={[chunk({ id: 'a' }), chunk({ id: 'b' })]}
      />,
    );
    expect(screen.getByText('2 chunks')).toBeInTheDocument();
  });

  it('links each chunk file path to its detail route', () => {
    render(
      <RepoContextView
        owner="o"
        repo="r"
        types={['doc']}
        chunks={[chunk({ file_path: 'specs/a/spec.md' })]}
      />,
    );
    expect(screen.getByRole('link', { name: 'specs/a/spec.md' })).toHaveAttribute(
      'href',
      '/repos/o/r/context/specs%2Fa%2Fspec.md',
    );
  });

  it('renders a chip per detected type and a search box', () => {
    const { container } = render(
      <RepoContextView owner="o" repo="r" types={['doc', 'code']} chunks={[chunk()]} />,
    );
    expect(screen.getByRole('link', { name: 'doc' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'code' })).toBeInTheDocument();
    expect(container.querySelector('form.search-form')).not.toBeNull();
  });

  it('shows the search-scoped empty state with the query', () => {
    render(<RepoContextView owner="o" repo="r" q="widgets" types={['doc']} chunks={[]} />);
    expect(screen.getByText('No context matches “widgets”.')).toBeInTheDocument();
  });

  it('shows the type-scoped empty state when a type filter yields nothing', () => {
    render(<RepoContextView owner="o" repo="r" type="spec" types={['spec']} chunks={[]} />);
    expect(screen.getByText('No spec context ingested yet.')).toBeInTheDocument();
  });

  it('shows the fresh-repo empty state when there are no chunks, type or query', () => {
    render(<RepoContextView owner="o" repo="r" types={[]} chunks={[]} />);
    expect(
      screen.getByText('No context ingested yet. Context will appear after the nightly ingestion runs.'),
    ).toBeInTheDocument();
  });

  it('renders the help popover trigger and lead description', () => {
    render(<RepoContextView owner="o" repo="r" types={['doc']} chunks={[chunk()]} />);
    expect(screen.getByRole('button', { name: 'How context is used' })).toBeInTheDocument();
    expect(
      screen.getByText('Conventions, ADRs, specs, and code ingested from this repo that agents use as context.'),
    ).toBeInTheDocument();
  });
});
