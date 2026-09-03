// Per-repo TTL cache for ingest-workflow status; short TTL safe since status only changes on PR merge.

import type { IngestWorkflowStatus } from "@/lib/ingest-workflow";

export const INGEST_STATUS_TTL_MS = 5 * 60_000;

interface CacheEntry {
  value: Promise<IngestWorkflowStatus>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Status for one workflow across many repos; kind namespaces cache key. */
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
