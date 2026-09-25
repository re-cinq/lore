// The refine pod's input file, built when the pod asks for it (specs/daily-digest FR9): GitHub is read for every repo of the channel, the sections are rendered around the intro/ending markers, and the draft is kept on the run so a retrying init downloads the same one and the run page shows what the agent read.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { DigestTexts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-port.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { resolveDigestSettings } from "@re-cinq/lore-shared/digest-settings.js";
import type { DigestRepo } from "@re-cinq/lore-shared/digest/codec.js";
import { dedupeImplemented } from "@re-cinq/lore-shared/digest/dedupe.js";
import { groupImplemented, groupRoadmap } from "@re-cinq/lore-shared/digest/group.js";
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
}

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
  deps: Pick<DraftDeps, "recentTexts" | "collect">,
): Promise<string> {
  const [sections, recent] = await Promise.all([
    Promise.all(digest.repos.map((entry) => repoSection(entry, deps.collect))),
    deps.recentTexts(digest.channel, RECENT_TEXTS_LIMIT),
  ]);

  return renderDigestDraft({
    header: { weekKey: digest.weekKey, date: digest.date },
    sections,
    wantsIntro: digest.repos.some((r) => r.sections.includes("summary")),
    wantsEnding: digest.repos.some((r) => r.sections.includes("morale")),
    recent,
  });
}

/** One repo's section; a repo whose read fails renders as a section saying so, so one broken repo never hides the others (FR6). */
export async function repoSection(
  entry: DigestRepo,
  collect: RepoCollector,
): Promise<string> {
  const settings = resolveDigestSettings({
    sections: entry.sections,
    group_by: entry.group_by,
  });

  try {
    const { merged, closed, open } = await collect(entry);

    return renderRepoSection({
      repo: entry.repo,
      settings,
      implemented: groupImplemented(dedupeImplemented(merged, closed), entry.group_by),
      roadmap: groupRoadmap(open, entry.group_by),
    });
  } catch (err) {
    return renderRepoSection({ repo: entry.repo, settings, error: (err as Error).message });
  }
}
