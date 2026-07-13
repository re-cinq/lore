/**
 * The code-review choreography (ADR-016 / assembly-lines): PR-lifecycle webhooks
 * start (or finish) short-lived `code-review` assembly lines. The line itself does
 * not listen for events — nodes are walked synchronously; all event wiring lives in
 * the Floor registry, which routes each event here. Every trigger enters the line at
 * `review`; `args.mode` (`review` | `reply`) tells the review node what it's looking at.
 *
 * Gated per-repo on `auto_review` (reused, widened from Lore's own PRs to all open
 * PRs). Loop-prevention is a correctness requirement: bot-authored PRs and bot
 * comments are skipped so the review never re-triggers on its own output.
 */

import type { EventHandler } from "../../main-loop/types.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../composition/project-boot.js";
import { shouldAutoReview } from "./should-auto-review.js";
import { loreTaskRef } from "../task/issue-body.js";

/** A GitHub App / bot login ends with `[bot]`; only human actors drive the review. */
export function isBotActor(login: string): boolean {
  return login.endsWith("[bot]");
}

export function decideReviewOnOpen(input: {
  autoReview: boolean;
  pr: PullRef | null;
}): { start: boolean } {
  const { autoReview, pr } = input;

  return {
    start:
      autoReview &&
      !!pr &&
      pr.state === "open" &&
      pr.draft !== true &&
      !isBotActor(pr.author ?? ""),
  };
}

export function decideReviewOnReply(input: {
  autoReview: boolean;
  pr: PullRef | null;
  commentAuthor: string;
}): { start: boolean } {
  const { autoReview, pr, commentAuthor } = input;

  return {
    start:
      autoReview &&
      !!pr &&
      pr.state === "open" &&
      pr.draft !== true &&
      !isBotActor(commentAuthor),
  };
}

/** The narrow project surface the handlers touch — kept minimal so tests use light doubles. */
export interface CodeReviewProject {
  pulls: {
    get(number: number): Promise<PullRef | null>;
    comment(number: number, body: string): Promise<void>;
  };
  assemblyLines: {
    start(
      definitionName: string,
      opts: { branch?: string; args?: Record<string, unknown> },
    ): Promise<string>;
    finishOpenByPr(prNumber: number, outcome: string): Promise<number>;
  };
}

export interface CodeReviewDeps {
  project(repo: string): Promise<CodeReviewProject>;
  autoReview(repo: string): Promise<boolean>;
  uiUrl(): string | undefined;
}

interface OpenParams {
  repo: string;
  pr_number: number;
}
interface ReplyParams extends OpenParams {
  comment_id: number;
  comment_author: string;
  comment_body: string;
}

export function createCodeReviewHandlers(deps: CodeReviewDeps): {
  onOpen: EventHandler;
  onReply: EventHandler;
  onClose: EventHandler;
} {
  const onOpen: EventHandler = async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const autoReview = await deps.autoReview(repo);

    if (!autoReview) {
      return;
    }
    const project = await deps.project(repo);
    const pr = await project.pulls.get(pr_number);

    if (!decideReviewOnOpen({ autoReview, pr }).start) {
      return;
    }
    const id = await project.assemblyLines.start("code-review", {
      branch: pr!.branch,
      args: {
        pr_number,
        mode: "review",
        description: `Review pull request #${pr_number} in ${repo} (branch ${pr!.branch}).`,
      },
    });

    await project.pulls.comment(
      pr_number,
      `Lore review has started — ${loreTaskRef(id, deps.uiUrl())}`,
    );
  };

  const onReply: EventHandler = async (params) => {
    const { repo, pr_number, comment_id, comment_author, comment_body } =
      params as unknown as ReplyParams;
    const autoReview = await deps.autoReview(repo);

    if (!autoReview || isBotActor(comment_author)) {
      return;
    } // loop guard before any API call
    const project = await deps.project(repo);
    const pr = await project.pulls.get(pr_number);

    if (
      !decideReviewOnReply({ autoReview, pr, commentAuthor: comment_author })
        .start
    ) {
      return;
    }
    await project.assemblyLines.start("code-review", {
      branch: pr!.branch,
      args: {
        pr_number,
        mode: "reply",
        comment_id,
        comment_body,
        description: `Respond to review feedback on pull request #${pr_number} in ${repo} (branch ${pr!.branch}). ${comment_author} replied: ${comment_body}`,
      },
    });
  };

  const onClose: EventHandler = async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const project = await deps.project(repo);

    await project.assemblyLines.finishOpenByPr(pr_number, "pr_closed");
  };

  return { onOpen, onReply, onClose };
}

const handlers = createCodeReviewHandlers({
  project: (repo) => projectFor(repo),
  autoReview: shouldAutoReview,
  uiUrl: () => process.env.LORE_UI_URL,
});

export const codeReviewOnOpen = handlers.onOpen;
export const codeReviewOnReply = handlers.onReply;
export const codeReviewOnClose = handlers.onClose;
