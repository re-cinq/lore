/** GitHub reads for the web UI, made through lore-api as the signed-in person (FR-037, FR-141, FR-230, FR-232, FR-234): this workload holds no GitHub credential. */

import { apiFetch } from "./api/client";
import { readRepoFile } from "./repo-file";

export type PRStatus =
  | "draft"
  | "open"
  | "checks-failing"
  | "changes-requested"
  | "approved"
  | "merged"
  | "closed";

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

export type RepoAccess = "ok" | "not-found" | "unknown";

// GitHub's own repo-response shape (description/default_branch/html_url), not a Lore table row.
// eslint-disable-next-line re-lint/no-row-types-outside-models
export interface RepoMeta {
  description: string | null;
  default_branch: string;
  html_url: string;
}

export interface RepoReadme {
  markdown: string;
  rawBaseUrl: string;
  htmlUrl: string;
}

/** Probe: can the signed-in person see this repo? Definitive 404 or unknown. */
export async function checkRepoAccess(repo: string): Promise<RepoAccess> {
  const result = await apiFetch<RepoMeta>(
    "lore-api",
    `/api/repos/${repo}/github/details`,
  );

  if (result.status === "ok") {
    return "ok";
  }

  return result.status === "error" && result.code === 404
    ? "not-found"
    : "unknown";
}

/** Whether each path exists on the repo's default branch: false on a definitive 404, null when the read failed otherwise. */
export async function checkRepoFiles(
  repo: string,
  paths: string[],
): Promise<Record<string, boolean | null>> {
  const entries = await Promise.all(
    paths.map(async (path) => [path, await fileExists(repo, path)] as const),
  );

  return Object.fromEntries(entries);
}

async function fileExists(repo: string, path: string): Promise<boolean | null> {
  const result = await apiFetch<{ content: string }>(
    "lore-api",
    `/api/repos/${repo}/github/file?path=${encodeURIComponent(path)}`,
  );

  if (result.status === "ok") {
    return true;
  }

  return result.status === "error" && result.code === 404 ? false : null;
}

/** Decoded UTF-8 file content from the repo's default branch; null when it cannot be read. */
export function getRepoFileContent(
  repo: string,
  path: string,
): Promise<string | null> {
  return readRepoFile(repo, path);
}

export async function getRepoMeta(repo: string): Promise<RepoMeta | null> {
  const result = await apiFetch<RepoMeta>(
    "lore-api",
    `/api/repos/${repo}/github/details`,
  );

  return result.status === "ok" ? result.data : null;
}

export async function getReadme(repo: string): Promise<RepoReadme | null> {
  const result = await apiFetch<RepoReadme>(
    "lore-api",
    `/api/repos/${repo}/github/readme`,
  );

  return result.status === "ok" ? result.data : null;
}

export async function getPRDetails(
  repo: string,
  prNumber: number,
): Promise<PRDetails> {
  const result = await apiFetch<PRDetails>(
    "lore-api",
    `/api/repos/${repo}/github/pulls/${prNumber}`,
  );

  if (result.status !== "ok") {
    throw new Error(`pull request ${repo}#${prNumber} could not be read`);
  }

  return result.data;
}
