// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RepoContextView, { type RepoContextChunk } from './RepoContextView';

const chunk = (over: Partial<RepoContextChunk>): RepoContextChunk => ({
  id: '1',
  file_path: 'docs/readme.md',
  content_type: 'doc',
  content: 'Hello context',
  ingested_at: '2026-06-03T10:00:00Z',
  ...over,
});

describe('RepoContextView', () => {
  it('renders the chunk count line from the chunks length', () => {
    render(<RepoContextView types={['doc']} chunks={[chunk({ id: 'a' }), chunk({ id: 'b' })]} />);
    expect(screen.getByText('2 chunks ingested')).toBeInTheDocument();
  });

  it('renders one capitalized pluralized heading per type in the types list', () => {
    render(
      <RepoContextView
        types={['doc', 'spec']}
        chunks={[chunk({ id: 'a', content_type: 'doc' }), chunk({ id: 'b', content_type: 'spec' })]}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'docs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'specs' })).toBeInTheDocument();
  });

  it('renders a spec-card with file path, type badge and truncated content for each chunk', () => {
    render(
      <RepoContextView
        types={['doc']}
        chunks={[chunk({ id: 'a', file_path: 'docs/a.md', content_type: 'doc', content: 'First' })]}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'docs/a.md' })).toBeInTheDocument();
    expect(screen.getByText('doc', { selector: 'span.badge' })).toBeInTheDocument();
    expect(screen.getByText('First...')).toBeInTheDocument();
  });

  it('groups chunks under their own content_type heading only', () => {
    render(
      <RepoContextView
        types={['doc', 'adr']}
        chunks={[
          chunk({ id: 'a', file_path: 'docs/a.md', content_type: 'doc' }),
          chunk({ id: 'b', file_path: 'adrs/b.md', content_type: 'adr' }),
        ]}
      />,
    );
    expect(screen.getByText('doc', { selector: 'span.badge' })).toBeInTheDocument();
    expect(screen.getByText('adr', { selector: 'span.badge' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'docs/a.md' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'adrs/b.md' })).toBeInTheDocument();
  });

  it('renders the help popover trigger button', () => {
    render(<RepoContextView types={['doc']} chunks={[chunk({})]} />);
    expect(screen.getByRole('button', { name: 'How context is used' })).toBeInTheDocument();
  });

  it('renders the lead description text', () => {
    render(<RepoContextView types={['doc']} chunks={[chunk({})]} />);
    expect(
      screen.getByText('Conventions, ADRs, specs, and code ingested from this repo that agents use as context.'),
    ).toBeInTheDocument();
  });

  it('shows the empty state and no type headings when there are no chunks', () => {
    render(<RepoContextView types={[]} chunks={[]} />);
    expect(
      screen.getByText('No context ingested yet. Context will appear after the nightly ingestion runs.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 chunks ingested')).toBeInTheDocument();
  });
});
