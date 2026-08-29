// Generic user-facing failure notification for any assembly-line run (station and
// agent nodes alike): every line closure funnels through finishLine, which calls
// this for failure outcomes — one seam covers code-review, comment-triage, detect
// fan-outs and every future definition. Channels: the repo's dark_factory.notify
// Slack routing (escalation level) plus, for PR-linked lines, a PR comment; the
// red lore/<definition> check comes from publishPrCheck reading the failed row.
// Best-effort by contract: a notification failure is audited, never thrown — it
// must not fail the line transition or re-drive the event retry.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";
import { projectFor } from "../../composition/project-boot.js";
import { writeAuditLog, type AuditLogEntry } from "../lib/audit.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { loreTaskRef } from "../task/issue-body.js";
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
  const rerunHint = isReviewDefinition(row.blueprintName)
    ? ` ${REVIEW_RERUN_HINT}`
    : "";

  return {
    message,
    prNumber,
    prComment: `Lore ${row.blueprintName} run failed (${outcome}${why}) — ${runRef}.${rerunHint}`,
  };
}

/** The send surfaces, injectable for tests; production resolves them per repo. */
export interface FailureNotifyPorts {
  notify?: (level: NotifyLevel, message: string) => Promise<unknown>;
  comment?: (prNumber: number, body: string) => Promise<unknown>;
  audit?: AuditPort;
  uiUrl?: string;
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

  const notify =
    ports.notify ??
    (async (level: NotifyLevel, message: string) =>
      (await projectFor(row.repo)).notify.notify(level, message));
  const comment =
    ports.comment ??
    (async (prNumber: number, body: string) =>
      (await projectFor(row.repo)).pulls.comment(prNumber, body));

  await attempt(row, "notify", ports.audit, () =>
    notify("escalation", notice.message),
  );

  if (notice.prNumber && notice.prComment) {
    const { prNumber, prComment } = notice;

    await attempt(row, "comment", ports.audit, () =>
      comment(prNumber, prComment),
    );
  }
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
    const entry: AuditLogEntry = {
      event_type: "failure_notify_failed",
      repo: row.repo,
      payload: {
        assembly_run_id: row.id,
        definition: row.blueprintName,
        channel,
        error: message,
      },
    };

    await writeAuditLog(entry, audit).catch(() => undefined);
  }
}
