// Posts a channel's digest to Slack from the external floor (specs/daily-digest FR14): the refine agent's message when it left one, the draft otherwise. The delivery is claimed under the VISIT's id, so a visit the floor retries after Slack refused everything claims afresh and replies in the thread the first one kept; a visit Slack refused part-way reports success, so nothing is posted twice.
import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { digestRunOfArgs } from "@re-cinq/lore-shared/digest/digest-run.js";
import {
  deliverDigest,
  DigestPartlyPosted,
  type DeliverDeps,
} from "@re-cinq/lore-shared/digest/deliver-digest.js";
import { NOT_A_DIGEST } from "../collect/station.js";
import { postDeps } from "../deps.js";

const DRAFT = "digest_draft";
const MESSAGE = "digest_message";

export function digestPostHandle(deps: DeliverDeps): Handle {
  return async (brief, tools) => {
    const digest = digestRunOfArgs(brief.visitId, brief.needs);

    if (!digest) {
      return { outcome: "failed", error: NOT_A_DIGEST };
    }

    try {
      const delivery = await deliverDigest(
        { ...digest, draft: await textOf(tools, DRAFT) },
        await refinedOf(brief, tools),
        deps,
      );

      return delivery.outcome === "skipped"
        ? { outcome: "failed", error: delivery.error }
        : { outcome: "success" };
    } catch (err) {
      return afterRefusal(err as Error);
    }
  };
}

/** A refusal before anything reached the channel is a failed visit, which the line retries. One after part of the digest landed is settled as posted, so it reports success: a retry would post that part a second time (FR7). */
function afterRefusal(err: Error): Report {
  if (err instanceof DigestPartlyPosted) {
    console.warn(`[digest] posted in part, then Slack refused: ${err.message}`);

    return { outcome: "success" };
  }

  return { outcome: "failed", error: err.message };
}

/** The agent's message as an upload the delivery can judge; null when the agent produced none, which is what makes the draft the message. */
async function refinedOf(brief: Brief, tools: Tools) {
  return MESSAGE in brief.needs
    ? { markdown: await textOf(tools, MESSAGE), exitCode: null }
    : null;
}

async function textOf(tools: Tools, need: string): Promise<string> {
  return (await tools.read(need)).toString("utf8");
}

export function startDigestPostStation(): RunningStation {
  return defineStation("digest-post", digestPostHandle(postDeps()));
}
