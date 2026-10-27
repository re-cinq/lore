/** The one way a message reaches Slack (specs/daily-digest FR7): `chat.postMessage`, with the thread fields the daily digest needs and the notifier never did. */

/** A block under the message text with a coloured bar down its left side; the digest gives each person one (FR6). */
export interface SlackAttachment {
  color: string;
  text: string;
}

export interface SlackPost {
  channel: string;
  text: string;
  attachments?: SlackAttachment[];
  /** Reply inside this thread (the parent's `ts`). */
  threadTs?: string;
  unfurlLinks?: boolean;
}

export interface SlackPosted {
  /** Slack's message id; a thread's parent `ts` is what its replies name. */
  ts: string;
}

export interface SlackPosterPort {
  post(input: SlackPost): Promise<SlackPosted>;
}
