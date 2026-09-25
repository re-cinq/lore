import type {
  SlackPost,
  SlackPosted,
  SlackPosterPort,
} from "./slack-poster-port.js";

/** Records every post; each gets a distinct ts so a thread reply can be told from its parent. Given `refuse`, every post fails the way Slack refuses one. */
export class InMemorySlackPoster implements SlackPosterPort {
  readonly posts: SlackPost[] = [];

  constructor(private readonly refuse?: string) {}

  async post(input: SlackPost): Promise<SlackPosted> {
    if (this.refuse) {
      throw new Error(`slack chat.postMessage: ${this.refuse}`);
    }
    this.posts.push(input);

    return { ts: `${this.posts.length}.000` };
  }
}
