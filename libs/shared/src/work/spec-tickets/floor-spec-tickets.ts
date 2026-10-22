// The spec-tickets line on the external floor: every merged specs/<name>/spec.md gets one run that splits the spec into a user story and task tickets, and a later merge of the same spec updates the tickets that run filed.
import type { FloorClient } from "@re-cinq/floor-client";
import { parseDocStatus, statusTier } from "../../domain/spec-status.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";

export const SPEC_TICKETS_LINE = "spec-tickets";

const SPEC_PATH = /^specs\/([^/]+)\/spec\.md$/;

export interface SpecMerge {
  repo: string;
  prNumber: number;
  merged: boolean;
  baseRef: string;
  mergeCommitSha: string;
}

export interface ChangedFile {
  path: string;
  patch: string | null;
}

export interface SpecTicketsDeps {
  floor: { lines: Pick<FloorClient["lines"], "start"> };
  defaultBranch(repo: string): Promise<string>;
  /** Every file the pull request touched, deleted ones included, with GitHub's patch of it when it gives one. */
  changedFiles(repo: string, prNumber: number): Promise<ChangedFile[]>;
  /** The file as the commit holds it; null when the commit has none. */
  readSpec(repo: string, path: string, ref: string): Promise<string | null>;
  /** The run keys of the repository's open spec-tickets runs. */
  openRunKeys(repo: string): Promise<string[]>;
}

/** The keys of the runs given, for the run keys a repository's open runs hold. */
export function runKeysOf(
  runs: readonly { startItems: Readonly<Record<string, { ref: string }>> }[],
): string[] {
  return runs.flatMap((run) => {
    const startItems: Partial<Record<string, { ref: string }>> = run.startItems;

    return startItems["key"]?.ref ?? [];
  });
}

/** The specs a pull request changed in more than their test links: a weekly upkeep PR that only moves or adds links must not file tickets for work already built. */
export function mergedSpecPaths(files: readonly ChangedFile[]): string[] {
  return files
    .filter(
      ({ path, patch }) => SPEC_PATH.test(path) && !onlyLinksChanged(patch),
    )
    .map(({ path }) => path);
}

const TEST_LINK = /\(?\[validated by [^\]]*\]\([^)]*\)\)?/g;

/** True when every removed line has an added line that differs from it by test links alone, and the other way round. */
export function onlyLinksChanged(patch: string | null): boolean {
  if (patch === null) {
    return false;
  }
  const removed = linesWithoutLinks(patch, "-");
  const added = linesWithoutLinks(patch, "+");

  return (
    removed.length === added.length &&
    removed.every((line, i) => line === added[i])
  );
}

/** The lines of one side of a patch with their test links and spacing taken out, sorted, so two sides can be compared. */
function linesWithoutLinks(patch: string, sign: "-" | "+"): string[] {
  return patch
    .split("\n")
    .filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3)))
    .map((line) =>
      line.slice(1).replace(TEST_LINK, "").replace(/\s+/g, " ").trim(),
    )
    .filter(Boolean)
    .sort();
}

/** One run per merged revision of a spec: two merges of the same spec before the first run ends each get their own. */
export function specTicketsKey(
  repo: string,
  specPath: string,
  mergeCommitSha: string,
): string {
  return `${repo}:${specPath}@${mergeCommitSha}`;
}

/** What the tickets of a spec are recognised by on every run. The issue markers split on the first slash, so the key holds none. */
export function specFilingKey(specPath: string): string {
  return `spec-${SPEC_PATH.exec(specPath)?.[1]}`;
}

export async function startSpecTicketRuns(
  merge: SpecMerge,
  deps: SpecTicketsDeps,
): Promise<string> {
  const tally = { started: 0, skipped: 0 };

  for (const specPath of await specsToTicket(merge, deps)) {
    tally[(await startFor(specPath, merge, deps)) ? "started" : "skipped"]++;
  }

  return `spec tickets: started ${tally.started}, skipped ${tally.skipped}`;
}

async function specsToTicket(
  merge: SpecMerge,
  deps: SpecTicketsDeps,
): Promise<string[]> {
  const { repo, prNumber, merged, baseRef } = merge;

  if (!merged || baseRef !== (await deps.defaultBranch(repo))) {
    return [];
  }

  return mergedSpecPaths(await deps.changedFiles(repo, prNumber));
}

async function startFor(
  specPath: string,
  merge: SpecMerge,
  deps: SpecTicketsDeps,
): Promise<boolean> {
  const key = specTicketsKey(merge.repo, specPath, merge.mergeCommitSha);

  if (!(await worthTicketing(specPath, key, merge, deps))) {
    return false;
  }
  await startLine(deps.floor.lines, SPEC_TICKETS_LINE, {
    repo: floorRepoOf(merge.repo),
    startItems: startItemsOf(specPath, key, merge),
  });

  return true;
}

function startItemsOf(
  specPath: string,
  key: string,
  { repo, baseRef, mergeCommitSha }: SpecMerge,
) {
  return {
    target: gitItem(repo, baseRef),
    spec_path: valueItem(specPath),
    merge_sha: valueItem(mergeCommitSha),
    key: valueItem(key),
  };
}

/** A spec the merge deleted, or one that is not buildable, a key already open is a redelivered merge. */
async function worthTicketing(
  specPath: string,
  key: string,
  { repo, mergeCommitSha }: SpecMerge,
  deps: SpecTicketsDeps,
): Promise<boolean> {
  const spec = await deps.readSpec(repo, specPath, mergeCommitSha);

  return (
    spec !== null &&
    isBuildable(spec) &&
    !(await deps.openRunKeys(repo)).includes(key)
  );
}

/** A spec that is rejected, retired or shipped has nothing left to build. */
function isBuildable(spec: string): boolean {
  const { status } = parseDocStatus(spec, "spec");

  return statusTier(status) !== "skip" && status !== "shipped";
}
