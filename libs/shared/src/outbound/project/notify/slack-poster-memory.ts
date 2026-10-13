import { enforceTrue } from "../../../lib/enforce.js";
import type {
  SlackPost,
  SlackPosted,
  SlackPosterPort,
} from "./slack-poster-port.js";

/** Records every post; each gets a distinct ts so a thread reply can be told from its parent. Given `refuse`, every post after the first `accepted` fails the way Slack refuses one. */
export class InMemorySlackPoster implements SlackPosterPort {
  readonly posts: SlackPost[] = [];

  constructor(
    private readonly refuse?: string,
    private readonly accepted = 0,
  ) {}

  async post(input: SlackPost): Promise<SlackPosted> {
    enforceTrue(
      !(this.refuse && this.posts.length >= this.accepted),
      Error,
      `slack chat.postMessage: ${this.refuse}`,
    );
    this.posts.push(input);

    return { ts: `${this.posts.length}.000` };
  }
}
