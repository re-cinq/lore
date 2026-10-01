// Builds a channel's digest draft on the external floor (specs/daily-digest FR14): GitHub is read for every due repo, the sections are rendered around the intro and ending markers, and the draft leaves as the file the refine agent reads and the post station falls back to.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { digestRunOfArgs } from "@re-cinq/lore-shared/digest/digest-run.js";
import {
  collectDraft,
  type DraftDeps,
} from "@re-cinq/lore-shared/digest/serve-draft.js";
import { collectDeps } from "../deps.js";

export type DigestCollectDeps = Pick<
  DraftDeps,
  "recentTexts" | "collect" | "namesFor"
>;

export const NOT_A_DIGEST =
  "the run carries no digest: channel, week_key, digest_date and digest_repos are all needed";

/** A repo whose GitHub read fails is a section saying so, never a failed visit; only a draft that cannot be built at all fails. */
export function digestCollectHandle(deps: DigestCollectDeps): Handle {
  return async (brief, tools) => {
    const digest = digestRunOfArgs(brief.visitId, brief.needs);

    if (!digest) {
      return { outcome: "failed", error: NOT_A_DIGEST };
    }

    try {
      const draft = await collectDraft(digest, deps);

      await tools.produce("digest_draft", Buffer.from(draft));

      return { outcome: "success" };
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

export function startDigestCollectStation(): RunningStation {
  return defineStation("digest-collect", digestCollectHandle(collectDeps()));
}
