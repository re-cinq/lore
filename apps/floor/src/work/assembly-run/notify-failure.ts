// Best-effort by contract: a notification failure is audited, never thrown — must not fail the line transition or re-drive the event retry.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";
import { projectFor } from "../../outbound/project-boot.js";
import { writeAuditLog, type AuditLogEntry } from "../../outbound/audit.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { loreTaskRef } from "../../domain/task-ref.js";
import {
  isReviewDefinition,
  REVIEW_RERUN_HINT,
} from "@re-cinq/lore-shared/review/review-definitions.js";
import {
  classifyError,
  failureHint,
  failureLabel,
  isFailureCategory,
  type FailureCategory,
} from "@re-cinq/lore-shared/error-classify.js";
import {
  NO_FAILURE_CONTEXT,
  resolveFailureContext,
  type FailedNode,
  type FailureContext,
} from "./failure-context.js";

/** Line outcomes that are normal course of business — everything else notifies. */
const BENIGN_OUTCOMES = new Set([
  "completed",
  "lease_held",
  "pr_created",
  "changes_requested",
  "pr_closed",
]);

export function isFailureOutcome(outcome: string): boolean {
  return !BENIGN_OUTCOMES.has(outcome);
}

export interface FailureNotice {
  message: string;
  prNumber: number | null;
  prComment: string | null;
}

export interface FailureCause {
  nodeId: string | null;
  category: FailureCategory;
  hint: string;
}

/** A class the node recorded wins; `unknown` is what a recorder writes when it did not classify, so the words are classified instead. */
export function failureCause(
  failedNode: FailedNode | null,
  reason: string | undefined,
): FailureCause {
  const category =
    recordedCategory(failedNode) ??
    classifyError(failureText(failedNode, reason)).category;

  return {
    nodeId: failedNode?.nodeId ?? null,
    category,
    hint: failureHint(category),
  };
}

function recordedCategory(
  failedNode: FailedNode | null,
): FailureCategory | null {
  const recorded = failedNode?.failureClass;

  if (!recorded || recorded === "unknown" || !isFailureCategory(recorded)) {
    return null;
  }

  return recorded;
}

/** The node's own words: the run's reason restates them with the hint appended, which the message already carries. */
function failureText(
  failedNode: FailedNode | null,
  reason: string | undefined,
): string {
  return failedNode?.failureDetail ?? reason ?? "";
}

/** Where the notice links to, and what the run's rows and task add to it. */
export interface NoticeOptions {
  uiUrl?: string;
  context?: FailureContext;
}

/** Pure: what to say and where — the sends live in {@link notifyLineFailure}. */
export function failureNotice(
  row: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  options: NoticeOptions = {},
): FailureNotice {
  const why = reason ? ` — ${reason}` : "";
  const message = slackFailureMessage(row, { outcome, reason }, options);
  const prNumber = prNumberOf(row);

  if (!prNumber) {
    return { message, prNumber: null, prComment: null };
  }

  const runRef = loreTaskRef(row.id, options.uiUrl);

  return {
    message,
    prNumber,
    prComment: failurePrComment(row, outcome, why, runRef),
  };
}

function prNumberOf(row: AssemblyRunRecord): number | null {
  return Number(row.args.pr_number) || null;
}

/** One fact per line, in Slack's own link syntax: Slack does not render markdown links. */
function slackFailureMessage(
  row: AssemblyRunRecord,
  { outcome, reason }: { outcome: string; reason: string | undefined },
  { uiUrl, context = NO_FAILURE_CONTEXT }: NoticeOptions,
): string {
  const cause = failureCause(context.failedNode, reason);
  const at = cause.nodeId ? ` at node \`${cause.nodeId}\`` : "";
  const words = failureText(context.failedNode, reason);
  const lines = [
    `Lore ${row.blueprintName} run failed on ${row.repo} (${outcome}): ${failureLabel(cause.category)}${at}`,
    `Hint: ${cause.hint}`,
    words ? reasonLine(words) : null,
    context.owner ? `Owner: ${context.owner}` : null,
    failureLinks(row, uiUrl, context).join(" · "),
  ];

  return lines.filter((line) => line !== null).join("\n");
}

/** Slack reads `&`, `<` and `>` as markup, and command output only reads right with its line breaks. */
function reasonLine(words: string): string {
  const escaped = words
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return escaped.includes("\n")
    ? `Reason:\n\`\`\`\n${escaped}\n\`\`\``
    : `Reason: ${escaped}`;
}

function failureLinks(
  row: AssemblyRunRecord,
  uiUrl: string | undefined,
  context: FailureContext,
): string[] {
  const links = [
    runLink(row.id, uiUrl),
    prLink(row, context.prUrl),
    context.issueUrl ? `<${context.issueUrl}|issue>` : null,
  ];

  return links.filter((link) => link !== null);
}

function runLink(runId: string, uiUrl: string | undefined): string {
  if (!uiUrl) {
    return `run ${runId}`;
  }

  return `<${uiUrl.replace(/\/+$/, "")}/assembly-runs/${runId}|run ${runId}>`;
}

function prLink(
  row: AssemblyRunRecord,
  taskPrUrl: string | null,
): string | null {
  const prNumber = prNumberOf(row);

  if (prNumber) {
    return `<https://github.com/${row.repo}/pull/${prNumber}|PR #${prNumber}>`;
  }

  return taskPrUrl ? `<${taskPrUrl}|PR>` : null;
}

/** The PR-side wording; a review line also carries how to re-run it. */
function failurePrComment(
  row: AssemblyRunRecord,
  outcome: string,
  why: string,
  runRef: string,
): string {
  const rerunHint = isReviewDefinition(row.blueprintName)
    ? ` ${REVIEW_RERUN_HINT}`
    : "";

  return `Lore ${row.blueprintName} run failed (${outcome}${why}) — ${runRef}.${rerunHint}`;
}

/** The send surfaces, injectable for tests; production resolves them per repo. */
export interface FailureNotifyPorts {
  notify?: (level: NotifyLevel, message: string) => Promise<unknown>;
  comment?: (prNumber: number, body: string) => Promise<unknown>;
  audit?: AuditPort;
  uiUrl?: string;
  context?: (row: AssemblyRunRecord) => Promise<FailureContext>;
}

interface ResolvedFailurePorts {
  notify: (level: NotifyLevel, message: string) => Promise<unknown>;
  comment: (prNumber: number, body: string) => Promise<unknown>;
}

export async function notifyLineFailure(
  row: AssemblyRunRecord,
  outcome: string,
  reason?: string,
  ports: FailureNotifyPorts = {},
): Promise<void> {
  const notice = failureNotice(row, outcome, reason, {
    uiUrl: ports.uiUrl ?? process.env.LORE_UI_URL,
    context: await contextOrNone(row, ports),
  });

  const { notify, comment } = resolveFailurePorts(row, ports);

  await attempt(row, "notify", ports.audit, () =>
    notify("escalation", notice.message),
  );

  await attemptPrComment(row, notice, comment, ports.audit);
}

/** A lookup that fails costs the notice its detail, never the notice itself. */
async function contextOrNone(
  row: AssemblyRunRecord,
  ports: FailureNotifyPorts,
): Promise<FailureContext> {
  const resolve = ports.context ?? resolveFailureContext;

  try {
    return await resolve(row);
  } catch (err) {
    console.warn(
      `[notify-failure] context for ${row.id} not resolved:`,
      (err as Error).message,
    );

    return NO_FAILURE_CONTEXT;
  }
}

/** Production resolves the send surfaces per repo; a caller can override either for tests. */
function resolveFailurePorts(
  row: AssemblyRunRecord,
  ports: FailureNotifyPorts,
): ResolvedFailurePorts {
  return {
    notify:
      ports.notify ??
      (async (level, message) =>
        (await projectFor(row.repo)).notify.notify(level, message)),
    comment:
      ports.comment ??
      (async (prNumber, body) =>
        (await projectFor(row.repo)).pulls.comment(prNumber, body)),
  };
}

/** The PR half of the notice, skipped when the run has no PR to speak to. */
async function attemptPrComment(
  row: AssemblyRunRecord,
  notice: FailureNotice,
  comment: ResolvedFailurePorts["comment"],
  audit: AuditPort | undefined,
): Promise<void> {
  const { prNumber, prComment } = notice;

  if (!prNumber || !prComment) {
    return;
  }
  await attempt(row, "comment", audit, () => comment(prNumber, prComment));
}

async function attempt(
  row: AssemblyRunRecord,
  channel: "notify" | "comment",
  audit: AuditPort | undefined,
  send: () => Promise<unknown>,
): Promise<void> {
  try {
    await send();
  } catch (err) {
    const message = (err as Error).message;

    console.error(`[notify-failure] ${channel} send failed:`, message);
    await writeAuditLog(notifyFailureEntry(row, channel, message), audit).catch(
      () => undefined,
    );
  }
}

function notifyFailureEntry(
  row: AssemblyRunRecord,
  channel: "notify" | "comment",
  message: string,
): AuditLogEntry {
  return {
    event_type: "failure_notify_failed",
    repo: row.repo,
    payload: {
      assembly_run_id: row.id,
      definition: row.blueprintName,
      channel,
      error: message,
    },
  };
}
