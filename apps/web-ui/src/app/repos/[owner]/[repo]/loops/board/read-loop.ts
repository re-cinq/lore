import "server-only";
import {
  getImplementationLoop,
  type ImplementationLoop,
} from "@/lib/api/backlog";
import { getCodeReview } from "@/lib/api/code-review";
import type { RepoLoop } from "@/lib/api/loops";
import type { ApiResult } from "@/lib/api/result";
import { getIssueTriage } from "@/lib/api/triage";
import {
  implementationNotice,
  implementationSections,
  pausedNotice,
  reviewSections,
  triageSections,
  type LoopRead,
  type LoopSections,
} from "./board";

/** One shown loop's rows, read through its own lore-api route. The implementation loop's raw read rides along for its onboarding banner. */
export async function readLoop(
  loop: RepoLoop,
  repo: string,
): Promise<LoopRead & { implementation?: ImplementationLoop }> {
  if (loop.key === "review") {
    return settle(loop, await getCodeReview(repo), (queues) =>
      reviewSections(loop, queues),
    );
  }

  if (loop.key === "triage") {
    return settle(loop, await getIssueTriage(repo), (triage) =>
      triageSections(loop, triage),
    );
  }

  return readImplementation(loop, repo);
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
