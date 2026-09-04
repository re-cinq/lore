// Post first, then transition, then publish the check: finishNodeAndAdvance can finish the line and both callers early-return on a non-running row, so anything posted after can't be repaired by a retry — shared by the node-event handler and the reaper so the dropped-event path stops silently losing reviews.

import {
  agentStderrError,
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
  reviewAlreadyPosted,
  reviewRunMarker,
  type ReviewPoster,
} from "../review/post-review.js";
import { parseReviewReply } from "@re-cinq/lore-shared/review/review-reply.js";
import { budgetSkipBody } from "@re-cinq/lore-shared/review/review-summary.js";
import { usage } from "../../kernel/queues.js";
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

// Unwraps the Agent output envelope AND lifts the terminal error text before the raw stream is gone — reading after unwrap always returned null, which is why FR6.14's billing alert never fired (billing errors misread as Job-level BackoffLimitExceeded, #1455).
export function normalizeAgentStatus(status: AgentNodeStatus): AgentNodeStatus {
  if (status.output === undefined) {
    return status;
  }
  // Falls back through stderr because a boot crash has no result line — without it, the walk misread a permanent misconfig as retryable infra and burned a 25min retry (run 129235d4, 2026-08-28).
  const errorText =
    terminalErrorText(status.output) ??
    agentStderrError(status.output) ??
    status.errorText;
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

// `iteration` keys the per-run dedupe marker (so a revisit still posts); unknown iteration skips marker+probe (fail open) rather than guessing `1`, which could suppress a revisit's real review.
export interface ReviewPorts {
  poster?: ReviewPoster;
  audit?: AuditPort;
  iteration?: number;
  /** Model(s) that billed against this visit; resolved by finishNodeTerminal. */
  model?: string;
}

// `already_posted` means the probe found this run's marker already on the PR (redelivered event or event-vs-reaper race), so nothing was re-posted.
export type ReviewPostOutcome =
  "posted" | "already_posted" | "no_findings" | "post_failed" | "not_review";

// The outage shape: review published nothing but the CR exited 0, so a bare `success` would finish the line green ("Approved." on an unreviewed PR) — `no_findings` with a `changes_requested` verdict is what #1401 was (JSON.parse died on unescaped quotes, findings lost, check green); the event handler's `agentCrVisible` guard keeps an unreadable CR from ever reaching this judgment.
export function reviewNodeResultOverride(
  post: ReviewPostOutcome,
  output: string | undefined,
  result: NodeResult,
): NodeResult {
  // Defer to a caller that already classified the failure — the reaper's timeout doors arrive with no output, which otherwise reads exactly like "ran and published nothing" and misrecords an evicted pod as a recipe/contract bug.
  if (result.failureClass) {
    return result;
  }

  if (post === "no_findings" && parseReviewVerdict(output) !== "success") {
    // Records WHY, not just that it failed — a bare failure renders identically to an evicted pod/dry account/token mismatch and cost two reviewers a false infra-outage hunt on 2026-08-24.
    const verdict = parseReviewVerdict(output);

    return {
      outcome: "failed",
      // `unknown`, not an invented class: FailureCategory is the closed taxonomy of infra failures driving retry/dispatch gating; this is a recipe/contract bug, and node-outcome already uses `unknown` for that.
      failureClass: "unknown",
      failureDetail:
        verdict === "changes_requested"
          ? "the review reached changes_requested but nothing was posted to the PR — its findings block did not parse, so the findings are lost"
          : "the review posted no findings and reached no verdict — it never got far enough to judge the diff",
    };
  }

  return result;
}

/** The model(s) that actually billed against this visit, read back from `llm_calls`: the dispatch spec snapshots the yaml default while the agent-definition row overrides it at run time, so the disclosure must name the reviewer that really judged the diff. Falls back to the node's declared model when nothing billed. */
async function resolveVisitModel(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
  modelsUsed?: (stationRunId: string) => Promise<string[]>,
): Promise<string | undefined> {
  try {
    const visits = await deps.assemblyRuns.listStationRuns(input.row.id);
    const visit = visits.find(
      (v) =>
        v.nodeId === input.nodeId &&
        (input.iteration === undefined || v.iteration === input.iteration),
    );
    const models = visit?.stationRunId
      ? await (modelsUsed ?? ((id) => usage().modelsUsed(id)))(
          visit.stationRunId,
        )
      : [];

    return models.length > 0 ? models.join(", ") : input.node.model;
  } catch {
    return input.node.model;
  }
}

function prNumberFromRow(row: AssemblyRunRecord): number {
  return Number(row.args.pr_number) || 0;
}

function reviewPromptApplies(node: RunGraphNode, prNumber: number): boolean {
  return REVIEW_PROMPT_REFS.has(node.prompt_ref ?? "") && prNumber > 0;
}

async function resolvePoster(
  row: AssemblyRunRecord,
  poster: ReviewPoster | undefined,
): Promise<ReviewPoster> {
  return poster ?? (await projectFor(row.repo)).pulls;
}

function reviewMarkerFor(
  row: AssemblyRunRecord,
  nodeId: string,
  iteration: number | undefined,
): string | undefined {
  return iteration === undefined
    ? undefined
    : reviewRunMarker(row.id, nodeId, iteration);
}

function withReviewMarker(body: string, marker: string | undefined): string {
  return marker ? `${body}\n\n${marker}` : body;
}

/** A review visit that failed on an exhausted LLM budget must not block the PR — an empty account is an operator problem, not the author's — so post an APPROVE saying loudly that no review happened (deduped by the same per-visit marker as a real review) and record the visit as success. */
export async function postBudgetSkipReview(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  ports: ReviewPorts = {},
): Promise<"posted" | "already_posted" | "not_applicable"> {
  const prNumber = prNumberFromRow(row);

  if (!reviewPromptApplies(node, prNumber)) {
    return "not_applicable";
  }
  const pulls = await resolvePoster(row, ports.poster);
  const marker = reviewMarkerFor(row, node.id, ports.iteration);

  if (marker && (await reviewAlreadyPosted(pulls, prNumber, marker))) {
    return "already_posted";
  }
  await pulls.createReview(prNumber, {
    event: "APPROVE",
    body: withReviewMarker(budgetSkipBody(ports.model), marker),
    comments: [],
  });
  await writeAuditLog(
    {
      event_type: "review_budget_skip",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        model: ports.model ?? null,
      },
    },
    ports.audit,
  );

  return "posted";
}

/** Post the review, record the outcome + advance, then publish the PR check. */
export async function finishNodeTerminal(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
): Promise<void> {
  const model = await resolveVisitModel(input, deps);

  // Out of budget: approve-with-notice (retry budget cannot help, only account topup).
  if (
    input.result.outcome === "failed" &&
    input.result.failureClass === "anthropic-credit" &&
    (await postBudgetSkipReview(input.row, input.node, {
      iteration: input.iteration,
      model,
    })) !== "not_applicable"
  ) {
    await finishNodeAndAdvance(
      {
        assemblyLineId: input.row.id,
        nodeId: input.nodeId,
        iteration: input.iteration,
        result: { outcome: "success" },
      },
      deps,
    );
    await publishCheck(input.row.id, deps);

    return;
  }

  const post = await postReviewFromNode(input.row, input.node, input.output, {
    iteration: input.iteration,
    model,
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

// Prompt refs whose nodes emit the REVIEW_FINDINGS + REVIEW_RESULT contract: the deep review on PR open and the fast re-check on every push, both posted through the same path.
const REVIEW_PROMPT_REFS = new Set(["code-review", "code-review-recheck"]);

async function auditReviewPostFailed(
  row: AssemblyRunRecord,
  prNumber: number,
  message: string,
  ports: ReviewPorts,
): Promise<void> {
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
}

interface PostedReviewContext {
  row: AssemblyRunRecord;
  prNumber: number;
  output: string | undefined;
}

/** Audits and classifies a posted-or-skipped review; the `no_findings`/`deduped`/`fallback` shapes each get their own audit row. */
async function classifyPostedReview(
  { row, prNumber, output }: PostedReviewContext,
  posted: Awaited<ReturnType<typeof maybePostReview>>,
  ports: ReviewPorts,
): Promise<ReviewPostOutcome> {
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
}

// A review node emits structured findings instead of posting them itself; render+post here — a review that computes findings and posts nothing must never go unaudited (both the throw and the silent no-parse are logged).
export async function postReviewFromNode(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  output?: string,
  ports: ReviewPorts = {},
): Promise<ReviewPostOutcome> {
  const prNumber = prNumberFromRow(row);

  if (!reviewPromptApplies(node, prNumber)) {
    return "not_review";
  }

  try {
    const pulls = await resolvePoster(row, ports.poster);
    const marker = reviewMarkerFor(row, node.id, ports.iteration);
    const diff = await pulls.getDiff(prNumber).catch(() => "");
    const posted = await maybePostReview(pulls, prNumber, output ?? "", {
      positions: commentablePositions(diff),
      marker,
      model: ports.model,
    });

    return await classifyPostedReview({ row, prNumber, output }, posted, ports);
  } catch (err) {
    await auditReviewPostFailed(row, prNumber, (err as Error).message, ports);

    return "post_failed";
  }
}

// The narrow PR surface the reply post touches; the dedupe-probe reads are optional — a poster without them just skips the probe (fail open: a rare duplicate beats a dropped reply).
export interface ReplyPoster {
  replyToReviewComment(
    number: number,
    commentId: number,
    body: string,
  ): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  listComments?(number: number): Promise<ReviewComment[]>;
  listIssueComments?(number: number): Promise<IssueComment[]>;
  // Optional like the reads above — a poster without the thread methods just skips resolution (fail open; specs/implementation-loop FR5).
  listReviewThreads?(number: number): Promise<ReviewThread[]>;
  resolveReviewThread?(threadId: string): Promise<void>;
}

// `iteration` keys the per-run dedupe marker (mirrors ReviewPorts) so a revisited refine node still posts while a redelivery does not; unknown iteration skips marker+probe (fail open) rather than guessing `1`.
export interface ReplyPorts {
  poster?: ReplyPoster;
  audit?: AuditPort;
  iteration?: number;
}

// Mirrors ReviewPostOutcome: `no_reply` = no REVIEW_REPLY block; reply posting is a side effect and never overrides the node outcome (REVIEW_RESULT drives success/failed).
export type ReplyPostOutcome =
  "posted" | "already_posted" | "no_reply" | "post_failed" | "not_reply";

// Invisible per-run identity leading every posted reply, keyed per iteration; runs BEFORE the node-outcome CAS (spec 6-dark-factory FR6.11) so this marker's probe is what makes a redelivered terminal event a no-op (#1004).
function replyRunMarker(
  assemblyLineId: string,
  nodeId: string,
  iteration: number,
): string {
  return `<!-- lore-reply-run: ${assemblyLineId}/${nodeId}/${iteration} -->`;
}

type ThreadResolveAudit = (
  payload: Record<string, unknown>,
  resolved: boolean,
) => Promise<void>;

/** Looks up the thread the reply landed in, auditing (and swallowing) a lookup failure or an unmatched comment. */
async function findRepliedThread(
  listReviewThreads: NonNullable<ReplyPoster["listReviewThreads"]>,
  prNumber: number,
  inReplyTo: number,
  audit: ThreadResolveAudit,
): Promise<ReviewThread | null> {
  try {
    const thread = findThreadForComment(
      await listReviewThreads(prNumber),
      inReplyTo,
    );

    if (!thread) {
      await audit({ reason: "no_thread_for_comment" }, false);
    }

    return thread;
  } catch (err) {
    await audit(
      { reason: "list_failed", error: (err as Error).message },
      false,
    );

    return null;
  }
}

/** Resolves the thread, auditing success or a swallowed resolve failure. */
async function resolveThreadSafely(
  resolveReviewThread: NonNullable<ReplyPoster["resolveReviewThread"]>,
  thread: ReviewThread,
  audit: ThreadResolveAudit,
): Promise<void> {
  try {
    await resolveReviewThread(thread.id);
    await audit({ thread_id: thread.id }, true);
  } catch (err) {
    await audit(
      {
        reason: "resolve_failed",
        thread_id: thread.id,
        error: (err as Error).message,
      },
      false,
    );
  }
}

// Resolve the thread a reply just landed in, best-effort (FR5): only on `address` intent (an `answer` leaves the human's thread open on purpose), joining the REST reply's comment id to GraphQL's databaseId via findThreadForComment; never fails the post that already succeeded.
async function resolveRepliedThread(
  row: AssemblyRunRecord,
  pulls: ReplyPoster,
  { prNumber, inReplyTo }: { prNumber: number; inReplyTo: number },
  ports: ReplyPorts,
): Promise<void> {
  if (row.args.intent !== "address") {
    return;
  }

  const { listReviewThreads, resolveReviewThread } = pulls;

  if (!listReviewThreads || !resolveReviewThread) {
    return;
  }
  const audit: ThreadResolveAudit = (payload, resolved) =>
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
  const thread = await findRepliedThread(
    listReviewThreads,
    prNumber,
    inReplyTo,
    audit,
  );

  if (!thread) {
    return;
  }
  await resolveThreadSafely(resolveReviewThread, thread, audit);
}

/** Which PR a reply targets, or null when this node isn't a reply-shaped one at all. */
function replyTargetPrNumber(
  row: AssemblyRunRecord,
  node: RunGraphNode,
): number | null {
  if (node.prompt_ref !== "code-review-refine") {
    return null;
  }

  return Number(row.args.pr_number) || null;
}

async function auditUnparsedReply(
  row: AssemblyRunRecord,
  prNumber: number,
  output: string | undefined,
  ports: ReplyPorts,
): Promise<void> {
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
}

/** The comment this reply is addressed to (if any) and its per-run dedupe marker. */
function replyIdentity(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  ports: ReplyPorts,
): { inReplyTo: number; marker: string | undefined } {
  const inReplyTo =
    Number(row.args.in_reply_to_id) || Number(row.args.comment_id) || 0;
  const marker =
    ports.iteration === undefined
      ? undefined
      : replyRunMarker(row.id, node.id, ports.iteration);

  return { inReplyTo, marker };
}

interface DeliverReplyParams {
  row: AssemblyRunRecord;
  prNumber: number;
  inReplyTo: number;
  marker: string | undefined;
  body: string;
  ports: ReplyPorts;
}

/** Posts the reply (or skips it as a dedupe) and, when it landed in a thread, resolves that thread. */
async function deliverReply(
  params: DeliverReplyParams,
): Promise<ReplyPostOutcome> {
  const { row, prNumber, inReplyTo, marker, body, ports } = params;
  const pulls = ports.poster ?? (await projectFor(row.repo)).pulls;

  if (marker && (await replyAlreadyPosted(pulls, prNumber, marker))) {
    await auditDedupedReply(row, prNumber, marker, ports);

    return "already_posted";
  }
  // The marker LEADS the comment because the body is agent-authored — trailing it risks an opening prefix that platform-github's listIssueComments filter drops.
  const stamped = marker ? `${marker}\n\n${body}` : body;

  if (inReplyTo > 0) {
    await pulls.replyToReviewComment(prNumber, inReplyTo, stamped);
    await resolveRepliedThread(row, pulls, { prNumber, inReplyTo }, ports);

    return "posted";
  }
  await pulls.comment(prNumber, stamped);

  return "posted";
}

async function auditReplyPostFailed(
  row: AssemblyRunRecord,
  prNumber: number,
  err: Error,
  ports: ReplyPorts,
): Promise<void> {
  console.error("[code-review-refine] post reply failed:", err.message);
  await writeAuditLog(
    {
      event_type: "review_reply_post_failed",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        error: err.message,
      },
    },
    ports.audit,
  );
}

// The code-review-refine node commits its fix but can't post to GitHub itself (no `gh` in the pod); it emits a fenced REVIEW_REPLY block, posted in-thread here — absent block or a throw is audited, never fatal.
export async function postReplyFromNode(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  output?: string,
  ports: ReplyPorts = {},
): Promise<ReplyPostOutcome> {
  const prNumber = replyTargetPrNumber(row, node);

  if (prNumber === null) {
    return "not_reply";
  }
  const body = parseReviewReply(output ?? "");

  if (!body) {
    await auditUnparsedReply(row, prNumber, output, ports);

    return "no_reply";
  }
  const { inReplyTo, marker } = replyIdentity(row, node, ports);

  try {
    return await deliverReply({
      row,
      prNumber,
      inReplyTo,
      marker,
      body,
      ports,
    });
  } catch (err) {
    await auditReplyPostFailed(row, prNumber, err as Error, ports);

    return "post_failed";
  }
}

// Whether this run's reply already reached the PR (either delivery shape); best-effort like the review probe — a missing read surface or a throw reports "not posted" so the guard never drops a reply, at the cost of a rare duplicate.
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

// The reply-side twin of `review_post_deduped` (#1004): this run's marker is already on the PR, so the reply post was skipped.
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

// The redelivery that #870 exists for: this run's marker is already on the PR, so the post was skipped — audited so a dedupe firing is visible next to the duplicate it prevented.
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

// The review reached the PR as a top-level comment after GitHub rejected the inline post (never-drop fallback) — a silent downgrade is invisible at the PR, so it gets an audit row like its siblings.
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

// The exact state that produced the outage: a verdict was reached, no findings parsed, and nothing at all was logged.
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

// Publish the line's current state as a PR check (in_progress while running, terminal once finished); best-effort — a missing `checks: write` never blocks.
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
