// The composition root of the digest's stations: per-repo Projects, the Slack directory and poster, and the digest_posts table, bound once so the people lookups keep their day-long memory across visits.
import { SlackDirectoryHttp } from "@re-cinq/lore-shared/project/notify/slack-directory-http.js";
import { SlackPosterHttp } from "@re-cinq/lore-shared/project/notify/slack-poster-http.js";
import { digestDraftSources } from "@re-cinq/lore-shared/digest/draft-sources.js";
import type { DeliverDeps } from "@re-cinq/lore-shared/digest/deliver-digest.js";
import { projectFor } from "../outbound/project-boot.js";
import { pipeline, settings } from "../outbound/queues.js";
import type { DigestCollectDeps } from "./collect/station.js";

export function collectDeps(): DigestCollectDeps {
  return {
    recentTexts: (channel, limit) =>
      pipeline().digestPosts.recentTexts(channel, limit),
    ...digestDraftSources({
      project: projectFor,
      slackUsersSetting: () => settings().orgSetting("slack_users"),
      directory: new SlackDirectoryHttp(process.env),
    }),
  };
}

/** Called when the stations start, after the pool exists. */
export function postDeps(): DeliverDeps {
  return {
    posts: pipeline().digestPosts,
    poster: new SlackPosterHttp(process.env),
  };
}
