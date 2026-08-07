"use server";

import { openIngestWorkflowPR, openTraceImpactWorkflowPR } from "@/lib/github";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
} from "@/lib/ingest-workflow";
import {
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_CONTENT,
} from "@/lib/trace-impact-workflow";
import { clearIngestStatusCache } from "@/lib/ingest-status-cache";
import { revalidatePath } from "next/cache";

/**
 * Open a fix-PR installing the canonical ingest workflow on each repo.
 * Fail-soft per repo so one bad repo never sinks the batch. Returns how
 * many PRs were opened and their urls.
 */
export async function fixIngestWorkflows(
  repos: string[],
): Promise<{ opened: number; prs: string[] }> {
  const results = await Promise.all(
    repos.map((repo) =>
      openIngestWorkflowPR(
        repo,
        LORE_INGEST_WORKFLOW_PATH,
        LORE_INGEST_WORKFLOW_CONTENT,
      )
        .then((pr) => pr?.url ?? null)
        .catch(() => null),
    ),
  );
  const prs = results.filter((url): url is string => url !== null);

  clearIngestStatusCache();
  revalidatePath("/");

  return { opened: prs.length, prs };
}

/**
 * Open a fix-PR installing the canonical spec-impact workflow on each repo.
 * Same fail-soft shape as the ingest fix. Worth surfacing separately: until a
 * repo is on v2 the backend suppresses its findings, so a stale workflow is not
 * a cosmetic drift but a check that is switched off.
 */
export async function fixTraceImpactWorkflows(
  repos: string[],
): Promise<{ opened: number; prs: string[] }> {
  const results = await Promise.all(
    repos.map((repo) =>
      openTraceImpactWorkflowPR(
        repo,
        TRACE_IMPACT_WORKFLOW_PATH,
        TRACE_IMPACT_WORKFLOW_CONTENT,
      )
        .then((pr) => pr?.url ?? null)
        .catch(() => null),
    ),
  );
  const prs = results.filter((url): url is string => url !== null);

  clearIngestStatusCache();
  revalidatePath("/");

  return { opened: prs.length, prs };
}
