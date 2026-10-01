import { defineStation } from "@re-cinq/floor-station";
import type { Handle, RunningStation } from "@re-cinq/floor-station";
import { projectFor } from "../../outbound/project-boot.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import { postReply, type ReplyPoster } from "./post-reply.js";

export interface PostReplyDeps {
  poster(repo: string): Promise<ReplyPoster>;
}

export function postReplyHandle(deps: PostReplyDeps): Handle {
  return async (brief, tools) => {
    const { repo, prNumber } = parsePullRequestUrl(brief.needs.pr_url);
    const replyOutput = (await tools.read("reply_output")).toString("utf8");

    await postReply({
      poster: await deps.poster(repo),
      prNumber,
      visitId: brief.visitId,
      iteration: brief.iteration,
      replyOutput,
      commentId: Number(brief.needs.comment_id) || 0,
      intent: brief.needs.intent,
    });

    return { outcome: "success", produced: { reply_url: brief.needs.pr_url } };
  };
}

export function startPostReplyStation(): RunningStation {
  return defineStation(
    "post-reply",
    postReplyHandle({ poster: projectPoster }),
  );
}

async function projectPoster(repo: string): Promise<ReplyPoster> {
  return (await projectFor(repo)).pulls;
}
