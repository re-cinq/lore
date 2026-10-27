import type { SlackAttachment } from "../../outbound/project/notify/slack-poster-port.js";
import { splitForSlack } from "./split-for-slack.js";
import { UNASSIGNED } from "./group.js";

/** The digest as Slack messages (specs/daily-digest FR6/FR8): each person's paragraph becomes an attachment with their own colour bar, under the intro and title as plain text; what follows the people (a repo that could not be read, the changelog links) is a reply after them, since Slack draws attachments below a message's text. */

export interface SlackMessage {
  text: string;
  attachments?: SlackAttachment[];
}

export interface SlackMessageLimits {
  attachments: number;
}

/** Slack allows 100 attachments a message; 20 keeps one reply readable. */
const ATTACHMENTS_PER_MESSAGE = 20;

export const UNASSIGNED_COLOR = "#9e9e9e";

const PALETTE = [
  "#2f6fdd",
  "#2eb67d",
  "#e01e5a",
  "#ecb22e",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#db2777",
];

const PERSON_NAME = /^\*([^*]+)\*$/;

export function toSlackMessages(
  message: string,
  limits: SlackMessageLimits = { attachments: ATTACHMENTS_PER_MESSAGE },
): SlackMessage[] {
  const paragraphs = message.trim().split(/\n{2,}/);
  const first = paragraphs.findIndex(isPersonBlock);

  if (first < 0) {
    return plain(message);
  }
  const rest = paragraphs.slice(first);
  const head = plain(paragraphs.slice(0, first).join("\n\n"));
  const lastHead = head.pop();

  return [
    ...head,
    ...peopleMessages(rest.filter(isPersonBlock), lastHead?.text ?? "", limits),
    ...plain(rest.filter((p) => !isPersonBlock(p)).join("\n\n")),
  ];
}

/** The people in replies of at most `limits.attachments`, the first under the head's last text. */
function peopleMessages(
  blocks: string[],
  text: string,
  limits: SlackMessageLimits,
): SlackMessage[] {
  const attachments = blocks.map(toAttachment);
  const replies = Math.ceil(attachments.length / limits.attachments);

  return Array.from({ length: replies }, (_, i) => ({
    text: i === 0 ? text : "",
    attachments: attachments.slice(
      i * limits.attachments,
      (i + 1) * limits.attachments,
    ),
  }));
}

/** A paragraph whose first line is only a bold name and whose other lines are bullets. */
function isPersonBlock(paragraph: string): boolean {
  const [name = "", ...rest] = paragraph.split("\n");

  return (
    PERSON_NAME.test(name) &&
    rest.length > 0 &&
    rest.every((line) => line.startsWith("•"))
  );
}

function toAttachment(block: string): SlackAttachment {
  const [firstLine = ""] = block.split("\n");
  const name = PERSON_NAME.exec(firstLine)?.[1] ?? "";

  return { color: colorFor(name), text: block };
}

/** The same colour for a name every day, so a person is found by colour; nobody's work is grey. */
export function colorFor(name: string): string {
  if (name === UNASSIGNED) {
    return UNASSIGNED_COLOR;
  }
  const hash = [...name].reduce(
    (acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );

  return PALETTE[hash % PALETTE.length] ?? UNASSIGNED_COLOR;
}

function plain(text: string): SlackMessage[] {
  return splitForSlack(text).map((chunk) => ({ text: chunk }));
}
