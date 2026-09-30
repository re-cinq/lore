// How Lore's names are spelled on the floor: a repository as `github.com/owner/name`, lowered as the floor keeps it, and a run's start items by kind.
import type { Item } from "@re-cinq/floor-client";

const GITHUB_HOST = "github.com";
const STARTED_BY = "lore";

export function floorRepoOf(repo: string): string {
  return `${GITHUB_HOST}/${repo.toLowerCase()}`;
}

export function loreRepoOf(floorRepo: string): string {
  return floorRepo.replace(`${GITHUB_HOST}/`, "");
}

export function pullRequestUrl(repo: string, prNumber: number): string {
  return `https://${GITHUB_HOST}/${repo}/pull/${prNumber}`;
}

/** The subject a review line keys its one open run on: the argument marked `subject`, by name and value. */
export function pullRequestSubject(repo: string, prNumber: number): string {
  return `pr_url:${pullRequestUrl(repo, prNumber)}`;
}

/** The branch is kept as written: git reads its case. */
export function gitItem(repo: string, branch: string): Item {
  return { kind: "git", ref: `${floorRepoOf(repo)}@${branch}`, by: STARTED_BY };
}

export function valueItem(value: string | number): Item {
  return { kind: "value", ref: String(value), by: STARTED_BY };
}

export function fileItem(blobHash: string): Item {
  return { kind: "file", ref: blobHash, by: STARTED_BY };
}
