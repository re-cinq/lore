// Announces a recorded release in the repository's Slack channel from the external floor (specs/scheduled-releases): one post per release. The announcement is claimed in the release store before anything is posted, so a visit retried after the claim posts nothing: at most once by design, a Slack refusal after the claim is not tried again.
import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import type { ChangelogReleasesPort } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-port.js";
import type { SlackPosterPort } from "@re-cinq/lore-shared/project/notify/slack-poster-port.js";
import type { SettingsPort } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import { announceDeps } from "../deps.js";
import { absentNeedsReport, optionalNeed } from "../needs.js";
import { announcementMessages, channelOf } from "./announcement.js";

export interface ReleaseAnnounceDeps {
  settings: Pick<SettingsPort, "rawSettings">;
  releases: Pick<ChangelogReleasesPort, "claimAnnouncement">;
  poster: SlackPosterPort;
}

const REQUIRED = ["release_repo", "release_version", "release_notes"];

export function releaseAnnounceHandle(deps: ReleaseAnnounceDeps): Handle {
  return async ({ needs }, tools) =>
    absentNeedsReport(needs, REQUIRED) ?? (await announce(deps, needs, tools));
}

async function announce(
  deps: ReleaseAnnounceDeps,
  needs: Brief["needs"],
  tools: Tools,
): Promise<Report> {
  const { release_repo: repo, release_version: version } = needs;

  try {
    const channel = channelOf(await deps.settings.rawSettings(repo));
    const claimed =
      channel !== null &&
      (await deps.releases.claimAnnouncement(repo, version));

    if (!claimed) {
      return { outcome: "success" };
    }
    await post(deps.poster, channel, await messagesOf(needs, tools));

    return { outcome: "success" };
  } catch (err) {
    return { outcome: "failed", error: errorMessage(err) };
  }
}

async function messagesOf(needs: Brief["needs"], tools: Tools) {
  return announcementMessages({
    name: optionalNeed(needs, "published_to") ?? needs.release_repo,
    version: needs.release_version,
    url: optionalNeed(needs, "release_url"),
    summary: (await tools.read("release_notes")).toString("utf8"),
  });
}

/** The first message opens the post; any the summary needed beyond it reply in its thread. */
async function post(
  poster: SlackPosterPort,
  channel: string,
  messages: ReturnType<typeof announcementMessages>,
): Promise<void> {
  const [first, ...rest] = messages;
  const { ts } = await poster.post({ channel, ...first, unfurlLinks: false });

  for (const message of rest) {
    await poster.post({
      channel,
      ...message,
      threadTs: ts,
      unfurlLinks: false,
    });
  }
}

export function startReleaseAnnounceStation(): RunningStation {
  return defineStation(
    "release-announce",
    releaseAnnounceHandle(announceDeps()),
  );
}
