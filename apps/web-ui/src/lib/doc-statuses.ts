// Reshapes the global doc list into the `repo::filePath` status map
// GlobalDocsView indexes by. Replaces the old spec-status-source fan-out,
// which fetched one document source per entry over HTTP; statuses now arrive
// with the list itself.

import type { GlobalDocEntry } from "@/lib/trace-api";
import type { SpecStatusInfo } from "@/lib/spec-status";

export const specStatusKey = (repo: string, filePath: string): string =>
  `${repo}::${filePath}`;

export function statusesByKey(
  entries: GlobalDocEntry[],
): Record<string, SpecStatusInfo> {
  const result: Record<string, SpecStatusInfo> = {};

  for (const entry of entries) {
    if (entry.status) {
      result[specStatusKey(entry.repo, entry.filePath)] = entry.status;
    }
  }

  return result;
}

/** Per-repo list pages key by bare file path — the repo is already fixed. */
export function statusesByPath(
  entries: Array<{ filePath: string; status: SpecStatusInfo | null }>,
): Record<string, SpecStatusInfo> {
  const result: Record<string, SpecStatusInfo> = {};

  for (const entry of entries) {
    if (entry.status) {
      result[entry.filePath] = entry.status;
    }
  }

  return result;
}
