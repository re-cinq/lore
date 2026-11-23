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

  return toSlackMessages(`*${name}* ${link}\n\n${slackMrkdwn(summary.trim())}`);
}

const MARKDOWN_TO_MRKDWN: [RegExp, string][] = [
  [/^[ \t]*[-*][ \t]+/gm, "• "],
  [/^#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, "*$1*"],
  [/\*\*(.+?)\*\*/g, "*$1*"],
  [/\[([^\]]+)\]\(([^)\s]+)\)/g, "<$2|$1>"],
];

/** The release notes are Markdown for the GitHub release; Slack reads its own mrkdwn, with no headings, single-star bold and <url|text> links. */
function slackMrkdwn(markdown: string): string {
  return MARKDOWN_TO_MRKDWN.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    markdown,
  );
}
