/**
 * The code-review choreography (ADR-012 / assembly-lines): PR-lifecycle webhooks
 * and PR comments start short-lived assembly lines. The line itself does not
 * listen for events — all wiring lives in the Floor registry.
 *
 * Triggers (ADR-012 amendment):
 * - deep review on open / out-of-draft / first push (`onTrigger`, first-review-only)
 * - fast `code-review-recheck` on every later push (`onTrigger` routes to it once
 *   the PR has been reviewed), so the formal verdict tracks the fix
 * - explicit `@lore review` comment (`onComment` keyword fast-path) forces a deep pass
 * - every other human comment is ignored while the Haiku `comment-triage` line
 *   is switched off (2026-09-03); `onCommentTriaged` still routes a finished
 *   triage line's action so re-enabling the start is a one-line change
 * - a formal "request changes" review → address (`onReviewSubmitted`)
 *
 * Both reviews emit structured findings and the Floor submits a formal
 * APPROVE/REQUEST_CHANGES verdict; code fixes are human-gated (the `address` intent).
 * Gated per-repo on `auto_review`; bot actors are skipped so the review never
 * re-triggers on its own output.
 */

import type { EventHandler } from "../../main-loop/types.js";
import type {
  PullRef,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { REVIEW_HELP } from "@re-cinq/lore-shared/review/review-summary.js";
import type { TriageAction } from "@re-cinq/lore-shared/review/comment-triage.js";
import { projectFor } from "../../composition/project-boot.js";
import { shouldAutoReview } from "./should-auto-review.js";
import { loreTaskRef } from "../task/issue-body.js";
import { reviewSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";

import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";
import type { ClosedRunRef } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { cleanupPerTaskToken } from "../watcher/agent-watcher.js";

/** A GitHub App / bot login ends with `[bot]`; only human actors drive the review. */
export function isBotActor(login: string): boolean {
  return login.endsWith("[bot]");
}

/** An explicit request to (re)review — the deterministic fast-path past the triage. */
export function isReviewRequest(body: string): boolean {
  return /(^|\s)[@/]?lore\s+review\b/i.test(body);
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

/**
 * Where the triage routes a classified comment. Pure so the routing table is
 * unit-testable; `ignore` yields null (no follow-up line, only the triage pod ran).
 */
export function routeTriagedComment(
  action: TriageAction,
  ctx: CommentContext,
): { definition: string; args: Record<string, unknown> } | null {
  const thread = {
    pr_number: ctx.pr_number,
    head_sha: ctx.head_sha,
    comment_id: ctx.comment_id,
    in_reply_to_id: ctx.in_reply_to_id,
    comment_body: ctx.comment_body,
  };

  if (action === "review") {
    return {
      definition: "code-review",
      args: {
        pr_number: ctx.pr_number,
        head_sha: ctx.head_sha,
        mode: "review",
        actor: ctx.actor,
        description: reviewDescription(ctx.repo, ctx.pr_number, ctx.branch),
      },
    };
  }

  if (action === "address" || action === "answer") {
    return {
      definition: "code-review-reply",
      args: {
        ...thread,
        mode: "reply",
        intent: action,
        actor: ctx.actor,
        description: replyDescription(action, ctx),
      },
    };
  }

  return null;
}

function reviewDescription(repo: string, pr: number, branch: string): string {
  return `Review pull request #${pr} in ${repo} (branch ${branch}).`;
}

function recheckDescription(repo: string, pr: number, branch: string): string {
  return `Re-check pull request #${pr} in ${repo} (branch ${branch}) after a new push.`;
}

function replyDescription(
  intent: "address" | "answer",
  ctx: CommentContext,
): string {
  const thread = ctx.in_reply_to_id
    ? ` (reply on review-comment thread ${ctx.in_reply_to_id})`
    : "";
  const head = `On pull request #${ctx.pr_number} in ${ctx.repo} (branch ${ctx.branch})${thread}, a human commented: ${ctx.comment_body}`;

  return intent === "address"
    ? `${head}\n\nThey approved a fix — implement it and commit to the PR branch, then confirm briefly in the thread.`
    : `${head}\n\nAnswer their question briefly in the review thread; do not change code.`;
}

/** The narrow project surface the handlers touch — kept minimal so tests use light doubles. */
export interface CodeReviewProject {
  pulls: {
    get(number: number): Promise<PullRef | null>;
    comment(number: number, body: string): Promise<void>;
    listComments(number: number): Promise<ReviewComment[]>;
  };
  assemblyRuns: {
    start(
      blueprintName: string,
      opts: {
        branch?: string;
        subjectKey?: string;
        args?: Record<string, unknown>;
      },
    ): Promise<string>;
    findOpenBySubject(subjectKey: string): Promise<{ id: string } | null>;
    finishOpenByPr(
      prNumber: number,
      outcome: string,
      definitions?: readonly string[],
    ): Promise<ClosedRunRef[]>;
    hasReviewedPr(prNumber: number): Promise<boolean>;
  };
}

export interface CodeReviewDeps {
  project(repo: string): Promise<CodeReviewProject>;
  autoReview(repo: string): Promise<boolean>;
  uiUrl(): string | undefined;
  /**
   * Reclaim the per-run GitHub token + AgentDefinition/Station triple a line
   * held. Needed here because closing a PR ends its review lines WITHOUT going
   * through `finishLine`, which is the only other place that reclaims —
   * idempotent, so a line the walk also closes is a harmless double-free.
   */
  cleanupToken(key: string): Promise<void>;
}

interface OpenParams {
  repo: string;
  pr_number: number;
}
interface CommentParams extends OpenParams {
  comment_id: number;
  comment_author: string;
  comment_body: string;
  in_reply_to_id?: number | null;
}
interface ReviewSubmittedParams extends OpenParams {
  review_id?: number | null;
  review_state?: string;
  review_author?: string;
  review_body?: string;
}

/**
 * The actual feedback of a submitted review: its body plus every inline comment
 * (with ids so the reply agent can target each thread). Pure; empty when the
 * review carried neither.
 */
export function reviewFeedback(
  body: string,
  comments: ReviewComment[],
): string {
  const lines = comments.map((c) => {
    const where = c.line === null ? c.path : `${c.path}:${c.line}`;

    return `- inline comment ${c.id} on ${where}: ${c.body}`;
  });
  const trimmed = body.trim();

  if (lines.length === 0) {
    return trimmed;
  }
  const inline = `Inline comments:\n${lines.join("\n")}`;

  return trimmed ? `${trimmed}\n\n${inline}` : inline;
}

/** The thread context threaded from a comment into the triage + follow-up lines. */
export interface CommentContext {
  repo: string;
  pr_number: number;
  branch: string;
  head_sha?: string;
  comment_id: number;
  comment_body: string;
  in_reply_to_id?: number | null;
  /** The human who triggered the line (commenter / reviewer) — surfaced as the
   *  run list's "By" for task-less lines via args.actor. */
  actor?: string;
}

/**
 * Start a `code-review` line (mode `review`) and post the how-to started comment.
 * `forced` bypasses the auto-review gate (explicit human intent: the `@lore review`
 * keyword, the manual UI button, or a triage `review` route). Returns the line id
 * or null when the gate/PR check skips it.
 */
export async function startReview(
  project: CodeReviewProject,
  input: {
    repo: string;
    prNumber: number;
    autoReview: boolean;
    forced?: boolean;
    actor?: string;
  },
  uiUrl?: string,
): Promise<string | null> {
  const pr = await project.pulls.get(input.prNumber);

  if (!pr || pr.state !== "open") {
    return null;
  }

  if (
    !input.forced &&
    !decideReviewOnOpen({ autoReview: input.autoReview, pr }).start
  ) {
    return null;
  }
  const subjectKey = reviewSubject(input.prNumber);
  // `start` on a subject is start-or-JOIN and answers with an id either way, so it
  // cannot tell us which happened. Ask first: whatever is open on this subject now
  // is what a join would hand back.
  //
  // Check-then-act, deliberately. Two triggers landing in the same instant can
  // still both read "nothing open" and both announce — but the subject key means
  // only ONE run exists either way, so the cost is a duplicate comment, not
  // duplicate work. Closing it properly wants a join signal from the port
  // (`start` answering `{id, joined}`), which is worth doing when something needs
  // to ACT on the difference; today only this message does.
  const alreadyOpen = await project.assemblyRuns.findOpenBySubject(subjectKey);
  const id = await project.assemblyRuns.start("code-review", {
    branch: pr.branch,
    // One review run per PR. Keyed on the PR rather than its branch: the branch is
    // a shared workspace — recheck, reply and triage lines all ride it and are MEANT
    // to overlap — so a branch key made a review defer to whichever comment line
    // happened to be open. They now declare no subject and are unaffected.
    subjectKey,
    args: {
      pr_number: input.prNumber,
      mode: "review",
      head_sha: pr.headSha,
      actor: input.actor ?? pr.author,
      description: reviewDescription(input.repo, input.prNumber, pr.branch),
    },
  });

  // A JOIN starts nothing, so it has nothing to announce — the run it handed back
  // was announced when it actually started. Announcing anyway posted the same
  // "Lore is reviewing this PR" comment, naming the same run, every time somebody
  // typed `@lore review` or pressed the UI button while a review was in flight.
  if (alreadyOpen?.id === id) {
    return id;
  }

  await project.pulls.comment(
    input.prNumber,
    `Lore is reviewing this PR — ${loreTaskRef(id, uiUrl)}.\n\n${REVIEW_HELP}`,
  );

  return id;
}

/**
 * Start a `code-review-recheck` line — the fast re-check that runs on every new
 * push after the deep review, re-deciding the PR's formal APPROVE / REQUEST_CHANGES
 * on the updated diff. Same open/non-draft/non-bot gate as the first review, but
 * posts no per-push comment (the deep review already posted the how-to, and a
 * comment per push would be noise). Returns the line id or null when the gate
 * skips it. Re-check lines are in `BRANCH_SHARED_WORKSPACE` (advance.ts) so a push
 * that lands while a review/reply line still holds the PR branch is never silently
 * dropped as `lease_held` by the overlap guard — the verdict update always runs.
 */
export async function startRecheck(
  project: CodeReviewProject,
  input: { repo: string; prNumber: number; autoReview: boolean },
): Promise<string | null> {
  const pr = await project.pulls.get(input.prNumber);

  if (!pr || pr.state !== "open") {
    return null;
  }

  if (!decideReviewOnOpen({ autoReview: input.autoReview, pr }).start) {
    return null;
  }

  return project.assemblyRuns.start("code-review-recheck", {
    branch: pr.branch,
    args: {
      pr_number: input.prNumber,
      mode: "recheck",
      head_sha: pr.headSha,
      actor: pr.author,
      description: recheckDescription(input.repo, input.prNumber, pr.branch),
    },
  });
}

export function createCodeReviewHandlers(deps: CodeReviewDeps): {
  onTrigger: EventHandler;
  onComment: EventHandler;
  onReviewSubmitted: EventHandler;
  onCommentTriaged: EventHandler;
  onClose: EventHandler;
} {
  const onTrigger: EventHandler = async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const autoReview = await deps.autoReview(repo);

    if (!autoReview) {
      return;
    }
    const project = await deps.project(repo);

    // First push → the deep review; every later push → the fast re-check, which
    // re-decides APPROVE / REQUEST_CHANGES on the updated diff so the PR's formal
    // verdict tracks the fix. `hasReviewedPr` matches the `code-review` line only,
    // so re-check lines never flip it and every subsequent push routes here.
    if (await project.assemblyRuns.hasReviewedPr(pr_number)) {
      await startRecheck(project, { repo, prNumber: pr_number, autoReview });

      return;
    }
    await startReview(
      project,
      { repo, prNumber: pr_number, autoReview },
      deps.uiUrl(),
    );
  };

  const onComment: EventHandler = async (params) => {
    const p = params as unknown as CommentParams;
    const autoReview = await deps.autoReview(p.repo);

    if (!autoReview || isBotActor(p.comment_author)) {
      return; // loop guard before any API call
    }
    const project = await deps.project(p.repo);
    const pr = await project.pulls.get(p.pr_number);

    if (
      !decideReviewOnReply({ autoReview, pr, commentAuthor: p.comment_author })
        .start
    ) {
      return;
    }

    // The Haiku `comment-triage` line is switched off (2026-09-03): only the explicit keyword drives a comment, so a plain reply publishes no `lore/comment-triage` check.
    if (!isReviewRequest(p.comment_body)) {
      return;
    }
    await startReview(
      project,
      {
        repo: p.repo,
        prNumber: p.pr_number,
        autoReview,
        forced: true,
        actor: p.comment_author,
      },
      deps.uiUrl(),
    );
  };

  const onReviewSubmitted: EventHandler = async (params) => {
    const p = params as unknown as ReviewSubmittedParams;
    const autoReview = await deps.autoReview(p.repo);

    if (!autoReview) {
      return;
    }

    // Only a "request changes" review is a work order — approvals and comment
    // reviews must not spawn an address line.
    if ((p.review_state ?? "changes_requested") !== "changes_requested") {
      return;
    }
    const project = await deps.project(p.repo);
    const pr = await project.pulls.get(p.pr_number);
    const author = p.review_author ?? "";

    if (!decideReviewOnReply({ autoReview, pr, commentAuthor: author }).start) {
      return;
    }
    const inline = p.review_id
      ? (await project.pulls.listComments(p.pr_number)).filter(
          (c) => c.review_id === p.review_id,
        )
      : [];
    const feedback = reviewFeedback(p.review_body ?? "", inline);
    const ctx: CommentContext = {
      repo: p.repo,
      pr_number: p.pr_number,
      branch: pr!.branch,
      head_sha: pr!.headSha,
      comment_id: 0,
      comment_body: feedback || "changes requested in a submitted review",
      actor: author,
    };
    const route = routeTriagedComment("address", ctx)!;

    await project.assemblyRuns.start(route.definition, {
      branch: pr!.branch,
      args: route.args,
    });
  };

  /** Route a finished comment-triage line's action to the follow-up line. */
  const onCommentTriaged: EventHandler = async (params) => {
    const action = String(params.action ?? "ignore") as TriageAction;
    const ctx = params.context as CommentContext | undefined;

    if (!ctx) {
      return;
    }
    const route = routeTriagedComment(action, ctx);

    if (!route) {
      return;
    }
    const project = await deps.project(ctx.repo);

    await project.assemblyRuns.start(route.definition, {
      branch: ctx.branch,
      args: route.args,
    });
  };

  const onClose: EventHandler = async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const project = await deps.project(repo);

    // ONLY this choreography's own lines. Closing a PR used to close every open
    // line carrying that number, which since the push node started stamping the
    // spec PR meant a merged spec PR closed the FEATURE-PLANNING line parked on
    // `merged` — killing the feature exactly one step before decomposition, on the
    // same event that was supposed to advance it.
    const closed = await project.assemblyRuns.finishOpenByPr(
      pr_number,
      "pr_closed",
      REVIEW_DEFINITIONS,
    );

    // Closing here BYPASSES finishLine, which is what normally reclaims a line's
    // per-run token and catalog triple — and the node's own terminal event cannot
    // pick up the slack, because it returns early once the row is no longer
    // running. Without this, every PR closed while its review was still in flight
    // left a `GH_TOKEN_*` key behind in `agent-secrets`, which is how that Secret
    // reached its 1MiB ceiling and took the fleet down on 2026-08-25.
    await Promise.all(
      closed.map((run) => deps.cleanupToken(run.taskId ?? run.id)),
    );
  };

  return { onTrigger, onComment, onReviewSubmitted, onCommentTriaged, onClose };
}

const handlers = createCodeReviewHandlers({
  project: (repo) => projectFor(repo),
  autoReview: shouldAutoReview,
  uiUrl: () => process.env.LORE_UI_URL,
  cleanupToken: cleanupPerTaskToken,
});

export const codeReviewOnTrigger = handlers.onTrigger;
export const codeReviewOnComment = handlers.onComment;
export const codeReviewOnReviewSubmitted = handlers.onReviewSubmitted;
export const codeReviewOnCommentTriaged = handlers.onCommentTriaged;
export const codeReviewOnClose = handlers.onClose;
