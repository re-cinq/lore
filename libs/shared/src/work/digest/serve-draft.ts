// The refine pod's input file, built when the pod asks for it (specs/daily-digest FR9): GitHub is read for every repo of the channel, one line per person is rendered under the intro marker, and the draft is kept on the run so a retrying init downloads the same one and the run page shows what the agent read.

import type { AssemblyRunRecord } from "../../outbound/project/assembly-runs/assembly-runs-port.js";
import type { DigestTexts } from "../../outbound/project/digest-posts/digest-posts-port.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import type { DigestRepo } from "./codec.js";
import { dedupeChanges } from "./dedupe.js";
import { groupPeople, type RepoWork } from "./group.js";
import {
  renderDigestDraft,
  renderPeople,
  renderRepoFailure,
} from "./render.js";
import { RECENT_TEXTS_LIMIT } from "./contract.js";
import { digestRunOf, type DigestRun } from "./digest-run.js";

/** What one repo's GitHub reads answer: merged and closed in its window, and everything open. */
export interface RepoChanges {
  merged: PullRef[];
  closed: IssueRef[];
  open: IssueRef[];
  openPrs: PullRef[];
}

export type RepoCollector = (entry: DigestRepo) => Promise<RepoChanges>;

export interface DraftDeps {
  runById(runId: string): Promise<AssemblyRunRecord | null>;
  mergeArgs(runId: string, patch: Record<string, unknown>): Promise<void>;
  recentTexts(channelId: string, limit: number): Promise<DigestTexts[]>;
  collect: RepoCollector;
  /** Slack display names of a repo's GitHub logins (FR12); a login left out keeps its GitHub name. */
  namesFor(repo: string, logins: string[]): Promise<Record<string, string>>;
}

type RepoDeps = Pick<DraftDeps, "collect" | "namesFor">;

/** The draft for a run: the stored one when the pod already asked once, else collected now and stored; null for a run that is not a digest run. */
export async function digestDraftOf(
  runId: string,
  deps: DraftDeps,
): Promise<string | null> {
  const run = await deps.runById(runId);
  const digest = run ? digestRunOf(run) : null;

  if (!digest) {
    return null;
  }

  if (digest.draft) {
    return digest.draft;
  }
  const draft = await collectDraft(digest, deps);

  await deps.mergeArgs(runId, { digest_draft: draft });

  return draft;
}

/** The draft itself, for a caller that already holds the run's facts and keeps the result where its engine keeps things. */
export async function collectDraft(
  digest: DigestRun,
  deps: Pick<DraftDeps, "recentTexts" | "collect" | "namesFor">,
): Promise<string> {
  const [reads, recent] = await Promise.all([
    Promise.all(digest.repos.map((entry) => readRepo(entry, deps))),
    deps.recentTexts(digest.channel, RECENT_TEXTS_LIMIT),
  ]);

  return renderDigestDraft({
    header: { weekKey: digest.weekKey, date: digest.date },
    lines: linesOf(reads),
    wantsIntro: digest.repos.some((r) => r.sections.includes("summary")),
    recentIntros: recent.map((texts) => texts.intro).filter(Boolean),
    voice: digest.voice,
  });
}

/** One line per person across every repo read, then one per repo that could not be read. */
function linesOf(reads: RepoRead[]): string[] {
  const people = groupPeople(reads.flatMap((read) => read.work ?? []));
  const names = Object.assign({}, ...reads.map((read) => read.names));

  return [
    ...renderPeople(people, names),
    ...reads.flatMap((read) => read.failure ?? []),
  ];
}

interface RepoRead {
  work?: RepoWork;
  names: Record<string, string>;
  /** The line saying the repo could not be read, so one broken repo never hides the others (FR6). */
  failure?: string;
}

/** A failed name lookup leaves the repo's people under their GitHub logins rather than failing the read. */
async function readRepo(entry: DigestRepo, deps: RepoDeps): Promise<RepoRead> {
  try {
    const work = workOf(await deps.collect(entry), entry);
    const logins = groupPeople([work]).map((person) => person.login);
    const names = await deps.namesFor(entry.repo, logins).catch(() => ({}));

    return { work, names };
  } catch (err) {
    return {
      names: {},
      failure: renderRepoFailure(entry.repo, (err as Error).message),
    };
  }
}

/** A list the repo did not enable is empty. */
function workOf(
  { merged, closed, open, openPrs }: RepoChanges,
  { sections }: DigestRepo,
): RepoWork {
  const none = { prs: [], issues: [] };

  return {
    did: sections.includes("implemented")
      ? dedupeChanges(merged, closed)
      : none,
    next: sections.includes("roadmap") ? dedupeChanges(openPrs, open) : none,
  };
}
