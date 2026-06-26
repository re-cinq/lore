import { describe, it, expect } from 'vitest';
import { isNavActive } from './nav-active';

describe('isNavActive', () => {
  it('matches the root link only on the exact root path', () => {
    expect(isNavActive('/', '/', '/')).toBe(true);
    expect(isNavActive('/assembly-lines', '/', '/')).toBe(false);
  });

  it('matches a non-root link on its exact path', () => {
    expect(isNavActive('/assembly-lines', '/assembly-lines', '/')).toBe(true);
  });

  it('matches a non-root link on its sub-routes', () => {
    expect(isNavActive('/assembly-lines/123', '/assembly-lines', '/')).toBe(true);
  });

  it('does not match a sibling that shares a prefix without a slash boundary', () => {
    expect(isNavActive('/assembly-liness', '/assembly-lines', '/')).toBe(false);
  });

  it('treats a repo base as the exact-only root for its tab group', () => {
    const base = '/repos/re-cinq/lore';
    expect(isNavActive(base, base, base)).toBe(true);
    expect(isNavActive(`${base}/specs`, base, base)).toBe(false);
    expect(isNavActive(`${base}/specs`, `${base}/specs`, base)).toBe(true);
    expect(isNavActive(`${base}/specs/a%2Fb.md`, `${base}/specs`, base)).toBe(true);
  });
});
