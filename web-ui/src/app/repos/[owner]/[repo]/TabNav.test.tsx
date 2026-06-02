// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TabNav from './TabNav';

const pathnameMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}));

const base = '/repos/re-cinq/lore';
const tabs = [
  { href: base, label: 'Overview' },
  { href: `${base}/tasks`, label: 'Tasks' },
  { href: `${base}/specs`, label: 'Specs' },
];

function activeLabels(): string[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.className.includes('active'))
    .map((link) => link.textContent || '');
}

describe('TabNav', () => {
  it('marks Overview active on the exact base path only', () => {
    pathnameMock.mockReturnValue(base);
    render(<TabNav tabs={tabs} base={base} />);
    expect(activeLabels()).toEqual(['Overview']);
  });

  it('marks Specs active on the specs route', () => {
    pathnameMock.mockReturnValue(`${base}/specs`);
    render(<TabNav tabs={tabs} base={base} />);
    expect(activeLabels()).toEqual(['Specs']);
  });

  it('keeps Specs active on a specs sub-route, not Overview', () => {
    pathnameMock.mockReturnValue(`${base}/specs/specs%2Flocal-task-runner%2Fspec.md`);
    render(<TabNav tabs={tabs} base={base} />);
    expect(activeLabels()).toEqual(['Specs']);
  });

  it('keeps Tasks active on a task detail sub-route', () => {
    pathnameMock.mockReturnValue(`${base}/tasks/123`);
    render(<TabNav tabs={tabs} base={base} />);
    expect(activeLabels()).toEqual(['Tasks']);
  });
});
