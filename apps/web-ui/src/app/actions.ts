'use server';

import { openIngestWorkflowPR } from '@/lib/github';
import { LORE_INGEST_WORKFLOW_PATH, LORE_INGEST_WORKFLOW_CONTENT } from '@/lib/ingest-workflow';
import { revalidatePath } from 'next/cache';

/**
 * Open a fix-PR installing the canonical ingest workflow on each repo.
 * Fail-soft per repo so one bad repo never sinks the batch. Returns how
 * many PRs were opened and their urls.
 */
export async function fixIngestWorkflows(repos: string[]): Promise<{ opened: number; prs: string[] }> {
  const results = await Promise.all(
    repos.map(repo =>
      openIngestWorkflowPR(repo, LORE_INGEST_WORKFLOW_PATH, LORE_INGEST_WORKFLOW_CONTENT)
        .then(pr => pr?.url ?? null)
        .catch(() => null),
    ),
  );
  const prs = results.filter((url): url is string => url !== null);
  revalidatePath('/');
  return { opened: prs.length, prs };
}
