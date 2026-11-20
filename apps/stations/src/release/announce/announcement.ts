import {
  toSlackMessages,
  type SlackMessage,
} from "@re-cinq/lore-shared/digest/slack-sections.js";

export interface Announcement {
  /** The repository people know the release by: the mirror's name when it was published there. */
  name: string;
  version: string;
  url: string | null;
  summary: string;
}

/** The repository's Slack channel, null when none is set. */
export function channelOf(
  settings: Record<string, unknown> | null,
): string | null {
  const channel = settings?.slack_channel_id;

  return typeof channel === "string" && channel !== "" ? channel : null;
}

/** A first line naming the repository and the version linked to its release, then the summary, cut into messages the way the digest is. */
export function announcementMessages({
  name,
  version,
  url,
  summary,
}: Announcement): SlackMessage[] {
  const link = url === null ? version : `<${url}|${version}>`;

  return toSlackMessages(`*${name}* ${link}\n\n${summary.trim()}`);
}
