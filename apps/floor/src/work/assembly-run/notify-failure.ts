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

/** Pure: what to say and where — the sends live in {@link notifyLineFailure}. */
export function failureNotice(
  row: AssemblyRunRecord,
  outcome: string,
  reason: string | undefined,
  uiUrl: string | undefined,
): FailureNotice {
  const runRef = loreTaskRef(row.id, uiUrl);
  const why = reason ? ` — ${reason}` : "";
  const message = `Lore ${row.blueprintName} run failed on ${row.repo} (${outcome}${why}): ${runRef}`;
  const prNumber = Number(row.args.pr_number) || null;

  if (!prNumber) {
    return { message, prNumber: null, prComment: null };
  }

  return {
    message,
    prNumber,
    prComment: failurePrComment(row, outcome, why, runRef),
  };
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
  const notice = failureNotice(
    row,
    outcome,
    reason,
    ports.uiUrl ?? process.env.LORE_UI_URL,
  );

  const { notify, comment } = resolveFailurePorts(row, ports);

  await attempt(row, "notify", ports.audit, () =>
    notify("escalation", notice.message),
  );

  await attemptPrComment(row, notice, comment, ports.audit);
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
