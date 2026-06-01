// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Linkified from './Linkified';

const repo = 're-cinq/lore';
const uuid = 'fb964a3c-2c4c-4de6-b76c-cebe715b51a9';

describe('Linkified', () => {
  it('renders a file path as a GitHub link that opens in a new tab', () => {
    render(<Linkified text="edit src/a.ts" repo={repo} branch="main" />);
    const link = screen.getByRole('link', { name: 'src/a.ts' });
    expect(link).toHaveAttribute('href', 'https://github.com/re-cinq/lore/blob/main/src/a.ts');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders an issue reference as a GitHub link that opens in a new tab', () => {
    render(<Linkified text="see #424" repo={repo} />);
    const link = screen.getByRole('link', { name: '#424' });
    expect(link).toHaveAttribute('href', 'https://github.com/re-cinq/lore/issues/424');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders a task uuid as an internal pipeline link that opens in place', () => {
    render(<Linkified text={`task ${uuid}`} repo={repo} />);
    const link = screen.getByRole('link', { name: uuid });
    expect(link).toHaveAttribute('href', `/pipeline/${uuid}`);
    expect(link).not.toHaveAttribute('target');
  });

  it('renders plain prose with no references as text and no links', () => {
    render(<Linkified text="nothing here" repo={repo} />);
    expect(screen.getByText('nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders interleaved prose and a link in order', () => {
    const { container } = render(<Linkified text="edit src/a.ts now" repo={repo} branch="main" />);
    expect(container.textContent).toBe('edit src/a.ts now');
    expect(screen.getByRole('link', { name: 'src/a.ts' })).toBeInTheDocument();
  });
});
