// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createOnboardTask = vi.fn();
const redirect = vi.fn();
vi.mock('@/lib/onboard', () => ({ createOnboardTask: (...a: unknown[]) => createOnboardTask(...a) }));
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

import { reonboard } from './actions';

beforeEach(() => {
  createOnboardTask.mockReset();
  redirect.mockReset();
});

describe('reonboard', () => {
  it('creates an onboard task and redirects to the new task page', async () => {
    createOnboardTask.mockResolvedValue('task-9');

    await reonboard('re-cinq/x');

    expect(createOnboardTask).toHaveBeenCalledWith('re-cinq/x');
    expect(redirect).toHaveBeenCalledWith('/pipeline/task-9');
  });

  it('redirects back to the repo page when no task is created', async () => {
    createOnboardTask.mockResolvedValue(null);

    await reonboard('re-cinq/x');

    expect(redirect).toHaveBeenCalledWith('/repos/re-cinq/x');
  });
});
