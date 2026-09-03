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
import type { FixWorkflowResult } from "@/lib/fix-workflow-result";
import { revalidatePath } from "next/cache";

// Fail-soft per repo, every failure reported with its reason — a silent App-permission gap once opened zero PRs org-wide.
async function openFixPRs(
  repos: string[],
  open: (repo: string) => Promise<{ url: string; number: number } | null>,
): Promise<FixWorkflowResult> {
  const results = await Promise.all(
    repos.map(async (repo) => {
      try {
        const pr = await open(repo);

        return pr
          ? { repo, url: pr.url }
          : {
              repo,
              error:
                "no PR was opened (GitHub App not configured, or no open fix PR found for the existing fix branch)",
            };
      } catch (err) {
        return {
          repo,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  const prs = results
    .map((r) => ("url" in r ? r.url : null))
    .filter((url): url is string => url !== null);
  const failed = results.filter(
    (r): r is { repo: string; error: string } => "error" in r,
  );

  clearIngestStatusCache();
  revalidatePath("/");

  return { opened: prs.length, prs, failed };
}

/** Open a fix-PR installing the canonical ingest workflow on each repo. */
export async function fixIngestWorkflows(
  repos: string[],
): Promise<FixWorkflowResult> {
  return openFixPRs(repos, (repo) =>
    openIngestWorkflowPR(
      repo,
      LORE_INGEST_WORKFLOW_PATH,
      LORE_INGEST_WORKFLOW_CONTENT,
    ),
  );
}

// Separate from fixIngestWorkflows: until a repo is on v2 the backend suppresses its findings, so a stale workflow disables the check entirely.
export async function fixTraceImpactWorkflows(
  repos: string[],
): Promise<FixWorkflowResult> {
  return openFixPRs(repos, (repo) =>
    openTraceImpactWorkflowPR(
      repo,
      TRACE_IMPACT_WORKFLOW_PATH,
      TRACE_IMPACT_WORKFLOW_CONTENT,
    ),
  );
}
