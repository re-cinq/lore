import { describe, it, expect } from 'vitest';
import { validateSpecPath } from './spec-path';

describe('validateSpecPath', () => {
  it('accepts a nested .md path unchanged', () => {
    expect(validateSpecPath('specs/my-feature/spec.md')).toEqual({
      valid: true,
      path: 'specs/my-feature/spec.md',
    });
  });

  it('strips leading slashes and stays valid', () => {
    expect(validateSpecPath('///specs/spec.md')).toEqual({
      valid: true,
      path: 'specs/spec.md',
    });
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateSpecPath('  notes.md  ')).toEqual({ valid: true, path: 'notes.md' });
  });

  it('rejects a path that does not end with .md', () => {
    expect(validateSpecPath('specs/spec.txt')).toEqual({ valid: false, path: 'specs/spec.txt' });
  });

  it('rejects an empty string', () => {
    expect(validateSpecPath('')).toEqual({ valid: false, path: '' });
  });

  it('rejects a path that is only slashes', () => {
    expect(validateSpecPath('///')).toEqual({ valid: false, path: '' });
  });
});
