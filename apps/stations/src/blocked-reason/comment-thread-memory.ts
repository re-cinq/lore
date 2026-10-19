import type { IssueComment } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { CommentThread } from "./comment.js";

export interface StoredComment {
  number: number;
  id: number;
  body: string;
}

/** An in-memory conversation: every PR and issue comment of a repo, in posting order, and the id of every edit. */
export class InMemoryCommentThread implements CommentThread {
  readonly comments: StoredComment[];
  readonly edits: number[] = [];

  constructor(seeded: StoredComment[] = []) {
    this.comments = seeded.map((comment) => ({ ...comment }));
  }

  async listComments(number: number): Promise<IssueComment[]> {
    return this.comments
      .filter((comment) => comment.number === number)
      .map(({ id, body }) => ({ id, body, user: "lore[bot]", created_at: "" }));
  }

  async comment(number: number, body: string): Promise<void> {
    this.comments.push({ number, id: this.comments.length + 1, body });
  }

  async updateComment(id: number, body: string): Promise<void> {
    this.edits.push(id);
    this.comments
      .filter((comment) => comment.id === id)
      .forEach((comment) => (comment.body = body));
  }
}
