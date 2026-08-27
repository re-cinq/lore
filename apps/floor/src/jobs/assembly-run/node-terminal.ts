// What the Floor owes a node that has gone terminal, in the one order that
// survives a redelivery. Shared by the node-event handler (the normal path) and
// the reaper (the dropped-event path) — the reaper used to finish nodes without
// posting anything, so a review that arrived through the slower door was lost
// exactly as if it had never run.
//
// Order matters: `finishNodeAndAdvance` can finish the line, and both callers
// early-return on a non-running row, so anything posted after it can never be
// repaired by a retry. Post first, then transition, then publish the check (which
// reads the post-transition terminal state).

import {
  resultTextFromOutput,
  terminalErrorText,
  parseReviewVerdict,
  type AgentNodeStatus,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { finishNodeAndAdvance, type AdvanceDeps } from "./advance.js";
import {
  maybePostReview,
  reviewRunMarker,
  type ReviewPoster,
} from "../review/post-review.js";
import { parseReviewReply } from "@re-cinq/lore-shared/review/review-reply.js";
import { commentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import { publishPrCheck } from "./pr-check.js";
import { projectFor } from "../../composition/project-boot.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type {
  IssueComment,
  ReviewComment,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";

/**
 * Unwrap the Agent output envelope so every text parser downstream reads the
 * agent text rather than the NDJSON that carries it. Idempotent for already-plain
 * output, so it is safe at any read boundary.
 *
 * It also LIFTS the terminal error text while the raw stream is still here to
 * read. `terminalErrorText` needs the `is_error` result line, which only exists
 * before the unwrap — so every reader downstream saw `null` and fell back to the
 * CR's Job-level `failureReason` (`BackoffLimitExceeded…`) whatever the agent
 * actually said. That is why FR6.14's billing alert never fired once in
 * production: the classifier was reading a string that could never be a billing
 * error. Lifting it here fixes both doors at once, since the node-event handler
 * and the reaper both normalize before they classify.
 */
export function normalizeAgentStatus(status: AgentNodeStatus): AgentNodeStatus {
  if (status.output === undefined) {
    return status;
  }
  // Idempotent: a second pass over already-unwrapped text finds no result line,
  // so it must not erase what the first pass lifted.
  const errorText = terminalErrorText(status.output) ?? status.errorText;
  const unwrapped = { ...status, output: resultTextFromOutput(status.output) };

  return errorText === undefined ? unwrapped : { ...unwrapped, errorText };
}

export interface NodeTerminalInput {
  row: AssemblyRunRecord;
  node: RunGraphNode;
  nodeId: string;
  iteration?: number;
  result: NodeResult;
  /** The node's agent text, already normalized by {@link normalizeAgentStatus}. */
  output?: string;
}

/** Ports the review post writes through (production resolves both from the
 *  repo), plus the node visit's iteration — it keys the per-run dedupe marker,
 *  so a revisited review node still posts while a redelivery does not. An
 *  unknown iteration skips marker and probe entirely (fail open): guessing `1`
 *  would let iteration 1's marker suppress a revisit's real review, and the CAS
 *  treats undefined as "newest open visit", not "first". */
export interface ReviewPorts {
  poster?: ReviewPoster;
  audit?: AuditPort;
  iteration?: number;
}

/** How the review post went — the walk converts the outage shape into an honest
 *  node failure so the generic failure notification catches it. `already_posted`
 *  means the probe found this run's marker on the PR (a redelivered terminal
 *  event or an event-vs-reaper race) and nothing was re-posted. */
export type ReviewPostOutcome =
  "posted" | "already_posted" | "no_findings" | "post_failed" | "not_review";

/**
 * The outage shape: the review published nothing, yet the CR exited 0 —
 * recording `success` would finish the line green ("Approved." on an unreviewed
 * PR).
 *
 * `no_findings` means `maybePostReview` could parse neither a REVIEW_FINDINGS
 * block nor a bare approval, so it covers three cases, and only one of them is
 * benign:
 *
 * - **no verdict either** — the agent never reached a conclusion (it could not
 *   read the diff). Fails.
 * - **verdict `changes_requested`** — the review HAD something to say and could
 *   not say it. This is what #1401 was: the model emitted a findings block whose
 *   `body` carried unescaped quotes, `JSON.parse` died, nothing reached the PR,
 *   and the check went green while four findings (one blocking) were lost. Fails.
 * - **verdict `success`** — a legitimate minimal approve, which
 *   `approvedWithoutFindings` posts, so this combination does not arise in
 *   practice. Left untouched anyway: approving nothing harms nothing.
 *
 * A `post_failed` also stays — the verdict is real, and the throw is audited.
 *
 * A FOURTH case never reaches here, and must not: an output nobody could READ.
 * A CR in a cluster this Floor cannot interrogate answers null, which arrives
 * looking exactly like "the agent emitted nothing" and would be published as a
 * verdict on that reading. The event handler refuses that door upstream
 * (`agentCrVisible`), so every output this function judges is one that was
 * actually read.
 */
export function reviewNodeResultOverride(
  post: ReviewPostOutcome,
  output: string | undefined,
  result: NodeResult,
): NodeResult {
  if (post === "no_findings" && parseReviewVerdict(output) !== "success") {
    // WHY it failed, not just that it did. Recorded bare — which this did — the
    // node renders as `node "recheck" failed` with no class and no detail, which
    // is exactly how an evicted pod, a dry account and a token mismatch render.
    // On 2026-08-24 that cost two reviewers a hunt for an infrastructure outage
    // that did not exist; the review had simply found something and failed to
    // publish it.
    const verdict = parseReviewVerdict(output);

    return {
      outcome: "failed",
      // `unknown`, not an invented class: FailureCategory is the closed taxonomy
      // of INFRASTRUCTURE failures that drive retry and the account-wide dispatch
      // gate. This is a recipe/contract bug, and `unknown` is what node-outcome
      // already uses for that — the diagnosis belongs in the detail, which is the
      // part that was missing.
      failureClass: "unknown",
      failureDetail:
        verdict === "changes_requested"
          ? "the review reached changes_requested but nothing was posted to the PR — its findings block did not parse, so the findings are lost"
          : "the review posted no findings and reached no verdict — it never got far enough to judge the diff",
    };
  }

  return result;
}

/** Post the review, record the outcome + advance, then publish the PR check. */
export async function finishNodeTerminal(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
): Promise<void> {
  const post = await postReviewFromNode(input.row, input.node, input.output, {
    iteration: input.iteration,
  });

  await postReplyFromNode(input.row, input.node, input.output, {
    iteration: input.iteration,
  });

  await finishNodeAndAdvance(
    {
      assemblyLineId: input.row.id,
      nodeId: input.nodeId,
      iteration: input.iteration,
      result: reviewNodeResultOverride(post, input.output, input.result),
    },
    deps,
  );

  await publishCheck(input.row.id, deps);
}

/** Prompt refs whose nodes emit the REVIEW_FINDINGS + REVIEW_RESULT contract the
 *  deterministic poster renders as a formal review: the deep review on PR open and
 *  the fast re-check on every push. Both post through the same path. */
const REVIEW_PROMPT_REFS = new Set(["code-review", "code-review-recheck"]);

/**
 * A review node emits structured findings instead of posting them itself; render
 * and post them here. A review that computes findings and posts nothing is the
 * failure this module exists to make impossible to miss, so both the throw and
 * the silent no-parse are audited rather than warned away.
 */
export async function postReviewFromNode(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  output?: string,
  ports: ReviewPorts = {},
): Promise<ReviewPostOutcome> {
  if (!REVIEW_PROMPT_REFS.has(node.prompt_ref ?? "")) {
    return "not_review";
  }
  const prNumber = Number(row.args.pr_number) || 0;

  if (!prNumber) {
    return "not_review";
  }

  try {
    const pulls = ports.poster ?? (await projectFor(row.repo)).pulls;
    const marker =
      ports.iteration === undefined
        ? undefined
        : reviewRunMarker(row.id, node.id, ports.iteration);
    const diff = await pulls.getDiff(prNumber).catch(() => "");
    const positions = commentablePositions(diff);
    const posted = await maybePostReview(
      pulls,
      prNumber,
      output ?? "",
      positions,
      marker,
    );

    if (!posted) {
      await auditUnparsedFindings(row, prNumber, output, ports);

      return "no_findings";
    }

    if (posted.mode === "deduped") {
      await auditDedupedPost(row, prNumber, posted.marker, ports);

      return "already_posted";
    }

    if (posted.mode === "fallback") {
      await auditFallbackPost(row, prNumber, posted.error, ports);
    }

    return "posted";
  } catch (err) {
    const message = (err as Error).message;

    console.error("[code-review] post review failed:", message);
    await writeAuditLog(
      {
        event_type: "review_post_failed",
        repo: row.repo,
        payload: {
          pr_number: prNumber,
          assembly_run_id: row.id,
          error: message,
        },
      },
      ports.audit,
    );

    return "post_failed";
  }
}

/** The narrow PR surface the reply post touches — a light double in tests. The
 *  two reads back the dedupe probe; they are optional because a poster without
 *  them simply skips the probe (the guard fails open — a rare duplicate beats a
 *  dropped reply). */
export interface ReplyPoster {
  replyToReviewComment(
    number: number,
    commentId: number,
    body: string,
  ): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  listComments?(number: number): Promise<ReviewComment[]>;
  listIssueComments?(number: number): Promise<IssueComment[]>;
  /** Optional like the reads above — a poster without the thread methods just
   *  skips resolution (fail open; specs/implementation-loop FR5). */
  listReviewThreads?(number: number): Promise<ReviewThread[]>;
  resolveReviewThread?(threadId: string): Promise<void>;
}

/** Ports the reply post writes through (production resolves both from the
 *  repo), plus the node visit's iteration — same contract as
 *  {@link ReviewPorts}: it keys the per-run dedupe marker, so a revisited
 *  refine node still posts while a redelivery does not, and an unknown
 *  iteration skips marker and probe entirely (fail open) rather than guessing
 *  `1`, which could let a first post suppress a revisit's real reply. */
export interface ReplyPorts {
  poster?: ReplyPoster;
  audit?: AuditPort;
  iteration?: number;
}

/** How the reply post went (mirrors {@link ReviewPostOutcome}). `no_reply` when
 *  the refine node emitted no ` ```REVIEW_REPLY ` block; `not_reply` for any other
 *  node; `already_posted` when the probe found this run's marker on the PR (a
 *  redelivered terminal event or an event-vs-reaper race) and nothing was
 *  re-posted. Reply posting is a side effect — it never overrides the node
 *  outcome (the refine node's REVIEW_RESULT verdict drives success/failed). */
export type ReplyPostOutcome =
  "posted" | "already_posted" | "no_reply" | "post_failed" | "not_reply";

/**
 * Invisible per-run identity leading every posted reply (in-thread and
 * plain-comment delivery alike), keyed per iteration so a legitimate revisit
 * still posts. Mirrors {@link reviewRunMarker}: the reply post also runs BEFORE
 * the node-outcome CAS (post-then-transition, spec 6-dark-factory FR6.11), so a
 * redelivered terminal event re-executes it; the probe for this marker is what
 * makes the re-execution a no-op (#1004).
 */
function replyRunMarker(
  assemblyLineId: string,
  nodeId: string,
  iteration: number,
): string {
  return `<!-- lore-reply-run: ${assemblyLineId}/${nodeId}/${iteration} -->`;
}

/**
 * Resolve the thread a reply just landed in, best-effort (FR5): only on the
 * `address` intent — an `answer` leaves the human mid-conversation and their
 * thread open — and never failing the post that succeeded. The REST reply knows
 * only its comment id; GraphQL thread nodes carry each comment's databaseId,
 * so findThreadForComment joins the two. Every failure mode lands in the audit
 * log under one event with a reason discriminator.
 */
async function resolveRepliedThread(
  row: AssemblyRunRecord,
  pulls: ReplyPoster,
  prNumber: number,
  inReplyTo: number,
  ports: ReplyPorts,
): Promise<void> {
  if (row.args.intent !== "address") {
    return;
  }

  if (!pulls.listReviewThreads || !pulls.resolveReviewThread) {
    return;
  }
  const audit = (payload: Record<string, unknown>, resolved: boolean) =>
    writeAuditLog(
      {
        event_type: resolved
          ? "review_thread_resolved"
          : "review_thread_resolve_failed",
        repo: row.repo,
        payload: {
          pr_number: prNumber,
          assembly_run_id: row.id,
          in_reply_to_id: inReplyTo,
          ...payload,
        },
      },
      ports.audit,
    );

  let thread: ReviewThread | null;

  try {
    thread = findThreadForComment(
      await pulls.listReviewThreads(prNumber),
      inReplyTo,
    );
  } catch (err) {
    await audit(
      { reason: "list_failed", error: (err as Error).message },
      false,
    );

    return;
  }

  if (!thread) {
    await audit({ reason: "no_thread_for_comment" }, false);

    return;
  }

  try {
    await pulls.resolveReviewThread(thread.id);
  } catch (err) {
    await audit(
      {
        reason: "resolve_failed",
        thread_id: thread.id,
        error: (err as Error).message,
      },
      false,
    );

    return;
  }
  await audit({ thread_id: thread.id }, true);
}

/**
 * The code-review-refine node commits its fix (git + clone token) but cannot
 * post to GitHub itself — the pod has no `gh`. It emits a fenced REVIEW_REPLY
 * block; post it in-thread here (in_reply_to_id → the review-comment thread,
 * else a plain PR comment). Absent block or a throw is audited, never fatal.
 */
export async function postReplyFromNode(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  output?: string,
  ports: ReplyPorts = {},
): Promise<ReplyPostOutcome> {
  if (node.prompt_ref !== "code-review-refine") {
    return "not_reply";
  }
  const prNumber = Number(row.args.pr_number) || 0;

  if (!prNumber) {
    return "not_reply";
  }
  const body = parseReviewReply(output ?? "");

  if (!body) {
    await writeAuditLog(
      {
        event_type: "review_reply_unparsed",
        repo: row.repo,
        payload: {
          pr_number: prNumber,
          assembly_run_id: row.id,
          output_length: output?.length ?? 0,
        },
      },
      ports.audit,
    );

    return "no_reply";
  }
  const inReplyTo =
    Number(row.args.in_reply_to_id) || Number(row.args.comment_id) || 0;
  const marker =
    ports.iteration === undefined
      ? undefined
      : replyRunMarker(row.id, node.id, ports.iteration);

  try {
    const pulls = ports.poster ?? (await projectFor(row.repo)).pulls;

    if (marker && (await replyAlreadyPosted(pulls, prNumber, marker))) {
      await auditDedupedReply(row, prNumber, marker, ports);

      return "already_posted";
    }
    // The marker LEADS the comment because the body is agent-authored: trailing
    // it would let a reply opening with a prefix platform-github's
    // `listIssueComments` filter drops (`PR created:` / `Agent ` / `Task `) hide
    // the fallback comment from the probe (cf. FALLBACK_NOTE in
    // ../review/post-review.js, where the preamble is ours to pin; here it is not).
    const stamped = marker ? `${marker}\n\n${body}` : body;

    if (inReplyTo > 0) {
      await pulls.replyToReviewComment(prNumber, inReplyTo, stamped);
      await resolveRepliedThread(row, pulls, prNumber, inReplyTo, ports);
    } else {
      await pulls.comment(prNumber, stamped);
    }

    return "posted";
  } catch (err) {
    const message = (err as Error).message;

    console.error("[code-review-refine] post reply failed:", message);
    await writeAuditLog(
      {
        event_type: "review_reply_post_failed",
        repo: row.repo,
        payload: {
          pr_number: prNumber,
          assembly_run_id: row.id,
          error: message,
        },
      },
      ports.audit,
    );

    return "post_failed";
  }
}

/**
 * Whether this run's reply already reached the PR — through either delivery
 * shape (review-comment thread or plain PR comment). Best-effort like the
 * review post's probe: a poster without the read surface, or a probe that
 * throws, reports "not posted" so the reply is never dropped by its own guard;
 * the residual cost is a duplicate exactly as rare as the probe outage.
 */
async function replyAlreadyPosted(
  pulls: ReplyPoster,
  prNumber: number,
  marker: string,
): Promise<boolean> {
  if (!pulls.listComments || !pulls.listIssueComments) {
    return false;
  }

  try {
    const [threads, comments] = await Promise.all([
      pulls.listComments(prNumber),
      pulls.listIssueComments(prNumber),
    ]);

    return (
      threads.some((thread) => thread.body.includes(marker)) ||
      comments.some((comment) => comment.body.includes(marker))
    );
  } catch (err) {
    console.warn(
      `[code-review-refine] reply dedupe probe failed (${(err as Error).message}); posting anyway`,
    );

    return false;
  }
}

/** The reply-side twin of `review_post_deduped` (#1004): this run's marker is
 *  already on the PR, so the reply post was skipped. */
async function auditDedupedReply(
  row: AssemblyRunRecord,
  prNumber: number,
  marker: string,
  ports: ReplyPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_reply_post_deduped",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        marker,
      },
    },
    ports.audit,
  );
}

/** The redelivery that #870 exists for: this run's marker is already on the PR,
 *  so the post was skipped. Audited so a dedupe firing is visible next to the
 *  duplicate it prevented. */
async function auditDedupedPost(
  row: AssemblyRunRecord,
  prNumber: number,
  marker: string,
  ports: ReviewPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_post_deduped",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        marker,
      },
    },
    ports.audit,
  );
}

/** The review reached the PR, but as a top-level comment after GitHub rejected
 *  the inline post — the never-drop fallback. Nothing was lost, but a silent
 *  downgrade is invisible at the PR, so it gets an audit row like its siblings
 *  `review_findings_unparsed` and `review_post_failed`. */
async function auditFallbackPost(
  row: AssemblyRunRecord,
  prNumber: number,
  error: string,
  ports: ReviewPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_post_degraded",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        error,
      },
    },
    ports.audit,
  );
}

/** The exact state that produced the outage: a verdict was reached, no findings
 *  parsed, and nothing at all was logged. */
async function auditUnparsedFindings(
  row: AssemblyRunRecord,
  prNumber: number,
  output: string | undefined,
  ports: ReviewPorts,
): Promise<void> {
  const verdict = parseReviewVerdict(output);

  console.error(
    `[code-review] no REVIEW_FINDINGS parsed for PR #${prNumber} (verdict: ${verdict ?? "none"}) — nothing posted`,
  );
  await writeAuditLog(
    {
      event_type: "review_findings_unparsed",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        verdict,
        output_length: output?.length ?? 0,
      },
    },
    ports.audit,
  );
}

/** Publish the line's current state as a PR check (in_progress while running,
 *  terminal once finished). Best-effort — a missing `checks: write` never blocks. */
export async function publishCheck(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const [row, nodes] = await Promise.all([
    deps.assemblyRuns.getById(assemblyLineId),
    deps.assemblyRuns.listStationRuns(assemblyLineId),
  ]);

  if (!row || !(Number(row.args.pr_number) > 0)) {
    return;
  }
  const project = await projectFor(row.repo);

  await publishPrCheck(project.repo, row, nodes, process.env.LORE_UI_URL);
}
