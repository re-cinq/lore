import type { SlackPost, SlackPosted, SlackPosterPort } from "./slack-poster-port.js";

/** Records every post; each gets a distinct ts so a thread reply can be told from its parent. `refuse` makes the next post fail like Slack would. */
export class InMemorySlackPoster implements SlackPosterPort {
  readonly posts: SlackPost[] = [];
  refuse: string | null = null;

  async post(input: SlackPost): Promise<SlackPosted> {
    if (this.refuse) {
      throw new Error(`slack chat.postMessage: ${this.refuse}`);
    }
    this.posts.push(input);

    return { ts: `${this.posts.length}.000` };
  }
}
