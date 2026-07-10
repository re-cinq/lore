import { describe, it, expect } from 'vitest';
import { formatEnumLabel } from './enum-label';

describe('formatEnumLabel', () => {
  it('sentence-cases a snake_case value', () => {
    expect(formatEnumLabel('pull_request')).toBe('Pull request');
  });

  it('sentence-cases a kebab-case value', () => {
    expect(formatEnumLabel('feature-request')).toBe('Feature request');
  });

  it('uppercases a known acronym in full', () => {
    expect(formatEnumLabel('adr')).toBe('ADR');
  });

  it('uppercases an acronym word within a multi-word value', () => {
    expect(formatEnumLabel('pr-review')).toBe('PR review');
  });

  it('leaves a single lowercase word sentence-cased', () => {
    expect(formatEnumLabel('spec')).toBe('Spec');
  });

  it('falls back to sentence case for an unknown enum', () => {
    expect(formatEnumLabel('brand-new-thing')).toBe('Brand new thing');
  });

  it('returns an empty string unchanged', () => {
    expect(formatEnumLabel('')).toBe('');
  });
});
