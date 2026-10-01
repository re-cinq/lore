// How Lore's names are spelled on the floor: a repository as `github.com/owner/name`, lowered as the floor keeps it, and a run's start items by kind.
import type { Item } from "@re-cinq/floor-client";
import { enforceTrue } from "../../lib/enforce.js";

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

export interface PullRequestLocation {
  repo: string;
  prNumber: number;
}

const PULL_REQUEST_URL =
  /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)\/?$/;

/** The inverse of `pullRequestUrl`, for a station handed the address as a need. */
export function parsePullRequestUrl(url: string): PullRequestLocation {
  const match = PULL_REQUEST_URL.exec(url.trim());

  enforceTrue(match, Error, `not a GitHub pull request url: ${url}`);

  return { repo: match[1], prNumber: Number(match[2]) };
}

/** The branch is kept as written: git reads its case. */
export function gitItem(repo: string, branch: string): Item {
  return { kind: "git", ref: `${floorRepoOf(repo)}@${branch}`, by: STARTED_BY };
}

export interface GitRef {
  repo: string;
  branch: string;
}

/** The inverse of `gitItem`, for a service station handed a git need's ref as `host/owner/name@branch`. Splits on the FIRST `@`: a host, owner or repository name can never hold one, while git lets a branch (`feature@v2`), so everything after the first is the branch. */
export function parseGitRef(ref: string): GitRef {
  const at = ref.indexOf("@");

  enforceTrue(at > 0, Error, `not a git ref: ${ref}`);

  return { repo: loreRepoOf(ref.slice(0, at)), branch: ref.slice(at + 1) };
}

export function valueItem(value: string | number): Item {
  return { kind: "value", ref: String(value), by: STARTED_BY };
}

export function fileItem(blobHash: string): Item {
  return { kind: "file", ref: blobHash, by: STARTED_BY };
}
