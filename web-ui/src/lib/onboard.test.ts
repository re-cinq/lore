import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('./db', () => ({ query: (...args: unknown[]) => query(...args) }));

import { createOnboardTask } from './onboard';

beforeEach(() => query.mockReset());

describe('createOnboardTask', () => {
  it('inserts an onboard task and a pending event, returning the new id', async () => {
    query.mockResolvedValueOnce([{ id: 'task-1' }]).mockResolvedValueOnce([]);

    const id = await createOnboardTask('re-cinq/x');

    expect(id).toBe('task-1');
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("task_type, target_repo, created_by"),
      ['re-cinq/x', 're-cinq/x'],
    );
    expect(query.mock.calls[0][0]).toContain("'onboard'");
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('pipeline.task_events'),
      ['task-1'],
    );
  });

  it('returns null and skips the event insert when no task row is returned', async () => {
    query.mockResolvedValueOnce([]);

    const id = await createOnboardTask('re-cinq/x');

    expect(id).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
