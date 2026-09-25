// The refine pod's input file, built when the pod asks for it (specs/daily-digest FR9): GitHub is read for every repo of the channel, the sections are rendered around the intro/ending markers, and the draft is kept on the run so a retrying init downloads the same one and the run page shows what the agent read.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { DigestTexts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-port.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { resolveDigestSettings } from "@re-cinq/lore-shared/digest-settings.js";
import type { DigestRepo } from "@re-cinq/lore-shared/digest/codec.js";
import { dedupeImplemented } from "@re-cinq/lore-shared/digest/dedupe.js";
import {
  groupImplemented,
  groupRoadmap,
} from "@re-cinq/lore-shared/digest/group.js";
import {
  renderDigestDraft,
  renderRepoSection,
} from "@re-cinq/lore-shared/digest/render.js";
import { RECENT_TEXTS_LIMIT } from "@re-cinq/lore-shared/digest/contract.js";
import { digestRunOf, type DigestRun } from "./digest-run.js";

/** What one repo's GitHub reads answer for its window. */
export interface RepoChanges {
  merged: PullRef[];
  closed: IssueRef[];
  open: IssueRef[];
}

export type RepoCollector = (entry: DigestRepo) => Promise<RepoChanges>;

export interface DraftDeps {
  runById(runId: string): Promise<AssemblyRunRecord | null>;
  mergeArgs(runId: string, patch: Record<string, unknown>): Promise<void>;
  recentTexts(channelId: string, limit: number): Promise<DigestTexts[]>;
  collect: RepoCollector;
  /** Slack display names of the GitHub logins a repo's section groups by (FR12); a login left out keeps its GitHub name. */
  namesFor(repo: string, logins: string[]): Promise<Record<string, string>>;
}

type SectionDeps = Pick<DraftDeps, "collect" | "namesFor">;

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

async function collectDraft(
  digest: DigestRun,
  deps: Pick<DraftDeps, "recentTexts" | "collect" | "namesFor">,
): Promise<string> {
  const [sections, recent] = await Promise.all([
    sectionsOf(digest, deps),
    deps.recentTexts(digest.channel, RECENT_TEXTS_LIMIT),
  ]);

  return renderDigestDraft({
    header: { weekKey: digest.weekKey, date: digest.date },
    sections,
    wantsIntro: digest.repos.some((r) => r.sections.includes("summary")),
    wantsEnding: digest.repos.some((r) => r.sections.includes("morale")),
    recent,
    voice: digest.voice,
  });
}

/** Every repo's section; a voice gets an aside after each (FR13). */
function sectionsOf(digest: DigestRun, deps: SectionDeps): Promise<string[]> {
  const asides = digest.voice !== "";

  return Promise.all(
    digest.repos.map((entry) => repoSection({ entry, asides }, deps)),
  );
}

export interface SectionRequest {
  entry: DigestRepo;
  asides: boolean;
}

/** One repo's section; a repo whose read fails renders as a section saying so, so one broken repo never hides the others (FR6). */
export async function repoSection(
  { entry, asides }: SectionRequest,
  deps: SectionDeps,
): Promise<string> {
  const base = { repo: entry.repo, settings: sectionSettings(entry) };

  try {
    const lists = groupedLists(await deps.collect(entry), entry);
    const names = await peopleNames(entry, lists, deps);

    return renderRepoSection({ ...base, names, asides, ...lists });
  } catch (err) {
    return renderRepoSection({ ...base, error: (err as Error).message });
  }
}

function sectionSettings(entry: DigestRepo) {
  return resolveDigestSettings({
    sections: entry.sections,
    group_by: entry.group_by,
  });
}

/** The two lists of one repo, deduped and grouped the way the repo asked. */
function groupedLists(
  { merged, closed, open }: RepoChanges,
  entry: DigestRepo,
) {
  return {
    implemented: groupImplemented(
      dedupeImplemented(merged, closed),
      entry.group_by,
    ),
    roadmap: groupRoadmap(open, entry.group_by),
  };
}

/** Only a person-grouped section has people to name; a failed lookup leaves every group under its GitHub login rather than failing the section. */
async function peopleNames(
  entry: DigestRepo,
  lists: ReturnType<typeof groupedLists>,
  deps: SectionDeps,
): Promise<Record<string, string>> {
  if (entry.group_by !== "person") {
    return {};
  }
  const logins = [...lists.implemented, ...lists.roadmap].map((g) => g.key);

  return deps.namesFor(entry.repo, logins).catch(() => ({}));
}
