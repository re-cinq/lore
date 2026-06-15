import { describe, it, expect } from 'vitest';
import { classifyAgent } from './agent-classify';

describe('classifyAgent', () => {
  it('returns task when task_count is positive', () => {
    expect(classifyAgent({ task_count: 1 })).toBe('task');
    expect(classifyAgent({ task_count: 42 })).toBe('task');
  });

  it('returns local when task_count is zero', () => {
    expect(classifyAgent({ task_count: 0 })).toBe('local');
  });
});
