import "server-only";
import {
  getImplementationLoop,
  type ImplementationLoop,
} from "@/lib/api/backlog";
import { getAutoMerge } from "@/lib/api/auto-merge";
import { getCodeReview } from "@/lib/api/code-review";
import type { RepoLoop } from "@/lib/api/loops";
import type { ApiResult } from "@/lib/api/result";
import { getIssueTriage } from "@/lib/api/triage";
import { getSpecUpkeep } from "@/lib/api/spec-upkeep";
import { getDailyDigest } from "@/lib/api/daily-digest";
import { getSpecTickets } from "@/lib/api/spec-tickets";
import {
  implementationNotice,
  implementationSections,
  mergeSections,
  pausedNotice,
  reviewSections,
  triageSections,
  upkeepSections,
  digestSections,
  ticketsSections,
  type LoopRead,
  type LoopSections,
} from "./board";

type LoopReader = (loop: RepoLoop, repo: string) => Promise<LoopRead>;

/** Each loop but the implementation loop reads through its own lore-api route into the shared sections. */
const READERS: Partial<Record<RepoLoop["key"], LoopReader>> = {
  review: async (loop, repo) =>
    settle(loop, await getCodeReview(repo), (queues) =>
      reviewSections(loop, queues),
    ),
  merge: async (loop, repo) =>
    settle(loop, await getAutoMerge(repo), (merge) =>
      mergeSections(loop, merge),
    ),
  triage: async (loop, repo) =>
    settle(loop, await getIssueTriage(repo), (triage) =>
      triageSections(loop, triage),
    ),
  upkeep: async (loop, repo) =>
    settle(loop, await getSpecUpkeep(repo), (upkeep) =>
      upkeepSections(loop, upkeep),
    ),
  digest: async (loop, repo) =>
    settle(loop, await getDailyDigest(repo), (digest) =>
      digestSections(loop, digest),
    ),
  tickets: async (loop, repo) =>
    settle(loop, await getSpecTickets(repo), (tickets) =>
      ticketsSections(loop, tickets),
    ),
};

/** One shown loop's rows, read through its own lore-api route. The implementation loop's raw read rides along for its onboarding banner. */
export async function readLoop(
  loop: RepoLoop,
  repo: string,
): Promise<LoopRead & { implementation?: ImplementationLoop }> {
  const read = READERS[loop.key];

  return read ? read(loop, repo) : readImplementation(loop, repo);
}

async function readImplementation(loop: RepoLoop, repo: string) {
  const result = await getImplementationLoop(repo);
  const read = settle(loop, result, (backlog) =>
    implementationSections(loop, backlog),
  );

  if (result.status !== "ok") {
    return read;
  }

  return {
    ...read,
    implementation: result.data,
    backlogNotice: implementationNotice(loop),
  };
}

function settle<Read>(
  loop: RepoLoop,
  result: ApiResult<Read>,
  sections: (read: Read) => LoopSections,
): LoopRead {
  if (result.status === "ok") {
    return {
      loop,
      sections: sections(result.data),
      backlogNotice: pausedNotice(loop),
    };
  }

  const reason =
    result.status === "error" ? result.message : "Lore API unconfigured";

  return {
    loop,
    sections: null,
    failure: `Could not load ${loop.label} (${reason}) — check the Lore API connection and reload.`,
  };
}
