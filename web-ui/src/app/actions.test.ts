// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const openIngestWorkflowPR = vi.fn();
const revalidatePath = vi.fn();
vi.mock('@/lib/github', () => ({
  openIngestWorkflowPR: (...a: unknown[]) => openIngestWorkflowPR(...a),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { fixIngestWorkflows } from './actions';
import { LORE_INGEST_WORKFLOW_PATH, LORE_INGEST_WORKFLOW_CONTENT } from '@/lib/ingest-workflow';

beforeEach(() => {
  openIngestWorkflowPR.mockReset();
  revalidatePath.mockReset();
});

describe('fixIngestWorkflows', () => {
  it('opens a PR per repo with the canonical path and content', async () => {
    openIngestWorkflowPR
      .mockResolvedValueOnce({ url: 'https://gh/a/1', number: 1 })
      .mockResolvedValueOnce({ url: 'https://gh/b/2', number: 2 });

    const result = await fixIngestWorkflows(['re-cinq/a', 're-cinq/b']);

    expect(openIngestWorkflowPR).toHaveBeenCalledWith('re-cinq/a', LORE_INGEST_WORKFLOW_PATH, LORE_INGEST_WORKFLOW_CONTENT);
    expect(openIngestWorkflowPR).toHaveBeenCalledWith('re-cinq/b', LORE_INGEST_WORKFLOW_PATH, LORE_INGEST_WORKFLOW_CONTENT);
    expect(result).toEqual({ opened: 2, prs: ['https://gh/a/1', 'https://gh/b/2'] });
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it('counts only repos where a PR was opened, tolerating failures and nulls', async () => {
    openIngestWorkflowPR
      .mockResolvedValueOnce({ url: 'https://gh/a/1', number: 1 })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(null);

    const result = await fixIngestWorkflows(['re-cinq/a', 're-cinq/b', 're-cinq/c']);

    expect(result).toEqual({ opened: 1, prs: ['https://gh/a/1'] });
  });
});
