/**
 * Per-repo TTL cache for ingest-workflow status (#1027). The home page renders
 * force-dynamic, so without this every page view fanned out one GitHub API call
 * per onboarded repo against the App's shared rate limit — the same class as
 * the 114-request /specs incident documented in lib/trace-api.ts. The status
 * only changes when a workflow-install PR merges, so a short TTL is safe:
 * steady-state renders make zero GitHub calls.
 *
 * Entries store the in-flight promise, not the resolved value, so concurrent
 * renders on a cold cache share one fetch per repo. A rejected fetch resolves
 * to "aligned" (fail-soft — a transient GitHub error must never false-flag a
 * repo's workflow as missing; getRepoFileContent deliberately rethrows
 * non-404s for exactly this reason) and the fallback stays cached until the
 * TTL expires.
 */

import type { IngestWorkflowStatus } from "@/lib/ingest-workflow";

export const INGEST_STATUS_TTL_MS = 5 * 60_000;

interface CacheEntry {
  value: Promise<IngestWorkflowStatus>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Status for one workflow across many repos. `kind` namespaces the cache key:
 * more than one workflow is tracked now, and a bare repo key would serve the
 * ingest status for a spec-impact lookup.
 */
export async function getWorkflowStatuses(
  kind: string,
  repos: string[],
  fetchStatus: (repo: string) => Promise<IngestWorkflowStatus>,
  now: () => number = Date.now,
): Promise<Map<string, IngestWorkflowStatus>> {
  const entries = repos.map((repo) => {
    const key = `${kind}::${repo}`;
    const cached = cache.get(key);

    if (cached && cached.expiresAt > now()) {
      return { repo, value: cached.value };
    }
    const value = fetchStatus(repo).catch(
      (): IngestWorkflowStatus => "aligned",
    );

    cache.set(key, { value, expiresAt: now() + INGEST_STATUS_TTL_MS });

    return { repo, value };
  });

  const statuses = await Promise.all(entries.map((e) => e.value));

  return new Map(entries.map((e, i) => [e.repo, statuses[i]]));
}

export async function getIngestStatuses(
  repos: string[],
  fetchStatus: (repo: string) => Promise<IngestWorkflowStatus>,
  now: () => number = Date.now,
): Promise<Map<string, IngestWorkflowStatus>> {
  return getWorkflowStatuses("ingest", repos, fetchStatus, now);
}

export function clearIngestStatusCache(): void {
  cache.clear();
}
