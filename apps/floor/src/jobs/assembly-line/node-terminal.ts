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
  parseReviewVerdict,
  type AgentNodeStatus,
  type AssemblyLineNode,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { AssemblyLineRecord } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
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
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/**
 * Unwrap the Agent output envelope so every text parser downstream reads the
 * agent text rather than the NDJSON that carries it. Idempotent for already-plain
 * output, so it is safe at any read boundary.
 */
export function normalizeAgentStatus(status: AgentNodeStatus): AgentNodeStatus {
  if (status.output === undefined) {
    return status;
  }

  return { ...status, output: resultTextFromOutput(status.output) };
}

export interface NodeTerminalInput {
  row: AssemblyLineRecord;
  node: AssemblyLineNode;
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
 * The outage shape: the review produced neither findings nor a verdict (e.g. the
 * agent could not read the diff), yet the CR exited 0 — recording `success` would
 * finish the line green ("Approved." on an unreviewed PR). A verdict without a
 * findings block stays untouched: that is a legitimate minimal approve. A
 * `post_failed` also stays — the verdict is real, and the throw is audited.
 */
export function reviewNodeResultOverride(
  post: ReviewPostOutcome,
  output: string | undefined,
  result: NodeResult,
): NodeResult {
  if (post === "no_findings" && parseReviewVerdict(output) === null) {
    return { outcome: "failed" };
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
  row: AssemblyLineRecord,
  node: AssemblyLineNode,
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
          assembly_line_id: row.id,
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
 * The code-review-refine node commits its fix (git + clone token) but cannot
 * post to GitHub itself — the pod has no `gh`. It emits a fenced REVIEW_REPLY
 * block; post it in-thread here (in_reply_to_id → the review-comment thread,
 * else a plain PR comment). Absent block or a throw is audited, never fatal.
 */
export async function postReplyFromNode(
  row: AssemblyLineRecord,
  node: AssemblyLineNode,
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
          assembly_line_id: row.id,
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
          assembly_line_id: row.id,
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
  row: AssemblyLineRecord,
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
        assembly_line_id: row.id,
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
  row: AssemblyLineRecord,
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
        assembly_line_id: row.id,
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
  row: AssemblyLineRecord,
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
        assembly_line_id: row.id,
        error,
      },
    },
    ports.audit,
  );
}

/** The exact state that produced the outage: a verdict was reached, no findings
 *  parsed, and nothing at all was logged. */
async function auditUnparsedFindings(
  row: AssemblyLineRecord,
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
        assembly_line_id: row.id,
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
    deps.assemblyLines.getById(assemblyLineId),
    deps.assemblyLines.listNodes(assemblyLineId),
  ]);

  if (!row || !(Number(row.args.pr_number) > 0)) {
    return;
  }
  const project = await projectFor(row.repo);

  await publishPrCheck(project.repo, row, nodes, process.env.LORE_UI_URL);
}
