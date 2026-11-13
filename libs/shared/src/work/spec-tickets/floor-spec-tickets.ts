// The spec-tickets line on the external floor: every merged specs/<name>/spec.md gets one run that splits the spec into a user story and task tickets, and a later merge of the same spec updates the tickets that run filed. One run per spec is open at a time: a merge that lands while the earlier run is still filing cancels it, or two runs would each read "no tickets yet" and file over each other.
import type { FloorClient } from "@re-cinq/floor-client";
import { parseDocStatus, statusTier } from "../../domain/spec-status.js";
import { isTestFile } from "../../domain/test-paths.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";
import { planIdOfSpecBranch } from "../feature-planning/spec-branch.js";

export const SPEC_TICKETS_LINE = "spec-tickets";

const SPEC_PATH = /^specs\/([^/]+)\/spec\.md$/;

export interface SpecMerge {
  repo: string;
  prNumber: number;
  merged: boolean;
  baseRef: string;
  mergeCommitSha: string;
  /** The pull request's head branch. */
  branch: string;
}

export interface ChangedFile {
  path: string;
  patch: string | null;
}

export interface OpenSpecTicketsRun {
  id: string;
  key: string;
}

export interface SpecTicketsDeps {
  floor: {
    lines: Pick<FloorClient["lines"], "start">;
    runs: Pick<FloorClient["runs"], "cancel">;
  };
  /** The repository's spec tickets loop is on (`spec_tickets.enabled`, specs/spec-tickets FR14). */
  loopOn(repo: string): Promise<boolean>;
  defaultBranch(repo: string): Promise<string>;
  /** Every file the pull request touched, deleted ones included, with GitHub's patch of it when it gives one. */
  changedFiles(repo: string, prNumber: number): Promise<ChangedFile[]>;
  /** The file as the commit holds it; null when the commit has none. */
  readSpec(repo: string, path: string, ref: string): Promise<string | null>;
  /** The repository's open spec-tickets runs, each with its run key. */
  openRuns(repo: string): Promise<OpenSpecTicketsRun[]>;
}

/** The runs given with their run keys; a run without one is not the line's. */
export function openSpecTicketRunsOf(
  runs: readonly {
    id: string;
    startItems: Readonly<Record<string, { ref: string }>>;
  }[],
): OpenSpecTicketsRun[] {
  return runs.flatMap((run) => {
    const startItems: Partial<Record<string, { ref: string }>> = run.startItems;
    const key = startItems["key"]?.ref;

    return key === undefined ? [] : [{ id: run.id, key }];
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

const LINK = String.raw`\[[^\]]*\]\([^)\s]*\)`;
const LINK_RE = new RegExp(LINK, "g");
/** A parenthetical holding nothing but links, which is what a citation group is. */
const LINK_GROUP_RE = new RegExp(
  String.raw`\s*\(\s*${LINK}(?:\s*[,;]\s*${LINK})*\s*\)`,
  "g",
);
const COVERAGE_LABEL = /^\[(?:validated|implemented) by\b/;
const LINK_TARGET = /\]\(([^)#]*)/;
const LINE_ANCHOR_RE = /#L\d+(?:-L?\d+)?\)/g;

/** True when every removed line has an added line that differs from it by test links and moved line anchors alone, and the other way round. */
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
    .map((line) => withoutTestLinks(line.slice(1)))
    .filter(Boolean)
    .sort();
}

/** A line as far as its wording goes: test links out of their groups with the group's punctuation, any other link's line anchor dropped, spacing evened. */
function withoutTestLinks(line: string): string {
  return line
    .replace(LINK_GROUP_RE, groupWithoutTestLinks)
    .replace(LINK_RE, (link) => (isTestLink(link) ? "" : link))
    .replace(LINE_ANCHOR_RE, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function groupWithoutTestLinks(group: string): string {
  const kept = (group.match(LINK_RE) ?? []).filter((link) => !isTestLink(link));

  return kept.length > 0 ? ` (${kept.join(", ")})` : "";
}

/** A link says it is a test link in its label, or by pointing at a test file whatever its label says. */
function isTestLink(link: string): boolean {
  return (
    COVERAGE_LABEL.test(link) || isTestFile(LINK_TARGET.exec(link)?.[1] ?? "")
  );
}

/** One run per merged revision of a spec: two merges of the same spec before the first run ends each get their own. */
export function specTicketsKey(
  repo: string,
  specPath: string,
  mergeCommitSha: string,
): string {
  return `${repo}:${specPath}@${mergeCommitSha}`;
}

/** The spec a run's subject key (`key:<repo>:specs/<name>/spec.md@<sha>`) names, by its directory name; null for a key of another shape. */
export function specNameOfRunKey(subjectKey: string | null): string | null {
  return /specs\/([^/]+)\/spec\.md@/.exec(subjectKey ?? "")?.[1] ?? null;
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

  if (!merged || !(await deps.loopOn(repo))) {
    return [];
  }

  if (baseRef !== (await deps.defaultBranch(repo))) {
    return [];
  }

  return mergedSpecPaths(await deps.changedFiles(repo, prNumber));
}

/** One merged spec against the repository's open runs. */
interface SpecRevision {
  specPath: string;
  key: string;
  open: readonly OpenSpecTicketsRun[];
}

async function startFor(
  specPath: string,
  merge: SpecMerge,
  deps: SpecTicketsDeps,
): Promise<boolean> {
  const revision: SpecRevision = {
    specPath,
    key: specTicketsKey(merge.repo, specPath, merge.mergeCommitSha),
    open: await deps.openRuns(merge.repo),
  };

  if (!(await worthTicketing(revision, merge, deps))) {
    return false;
  }
  await cancelEarlierRuns(revision, merge.repo, deps.floor.runs);
  await startLine(deps.floor.lines, SPEC_TICKETS_LINE, {
    repo: floorRepoOf(merge.repo),
    startItems: startItemsOf(specPath, revision.key, merge),
  });

  return true;
}

/** `source_plan_id` is no `plan_id` on purpose: the issues station reads a `plan_id` as the key its tickets are recognised by. */
function startItemsOf(
  specPath: string,
  key: string,
  { repo, baseRef, mergeCommitSha, branch }: SpecMerge,
) {
  const sourcePlanId = planIdOfSpecBranch(branch);

  return {
    target: gitItem(repo, baseRef),
    spec_path: valueItem(specPath),
    merge_sha: valueItem(mergeCommitSha),
    key: valueItem(key),
    ...(sourcePlanId ? { source_plan_id: valueItem(sourcePlanId) } : {}),
  };
}

/** A spec the merge deleted, or one that is not buildable, a key already open is a redelivered merge. */
async function worthTicketing(
  { specPath, key, open }: SpecRevision,
  { repo, mergeCommitSha }: SpecMerge,
  deps: SpecTicketsDeps,
): Promise<boolean> {
  const spec = await deps.readSpec(repo, specPath, mergeCommitSha);

  return (
    spec !== null && isBuildable(spec) && !open.some((run) => run.key === key)
  );
}

/** An open run of an earlier merge of the same spec is filing tickets the new run would file again under other ids; the new run reads the branch as it stands, so nothing of the old one is lost. */
async function cancelEarlierRuns(
  { specPath, key, open }: SpecRevision,
  repo: string,
  runs: SpecTicketsDeps["floor"]["runs"],
): Promise<void> {
  const sameSpec = `${repo}:${specPath}@`;
  const earlier = open.filter(
    (run) => run.key !== key && run.key.startsWith(sameSpec),
  );

  await Promise.all(earlier.map((run) => runs.cancel(run.id, "superseded")));
}

/** A spec that is rejected, retired or shipped has nothing left to build. */
function isBuildable(spec: string): boolean {
  const { status } = parseDocStatus(spec, "spec");

  return statusTier(status) !== "skip" && status !== "shipped";
}
