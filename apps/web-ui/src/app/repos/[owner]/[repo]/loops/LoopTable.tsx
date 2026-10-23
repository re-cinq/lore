import type { ReactNode } from "react";
import { Alert } from "@/components/Alert";
import { PanelTable } from "@/components/Panel";
import styles from "./LoopTable.module.scss";

// The pipelines-style table every loop's page lists its work in: Status (tone badge + relative time), the thing worked, Stages, Actions. Each loop supplies its own rows; the chrome, the tones and the relative time live here once.

/** GitLab-pipelines-style status tones, keyed on a row's state. */
const STATUS_TONE: Record<string, "success" | "danger" | "info" | "neutral"> = {
  completed: "success",
  merged: "success",
  success: "success",
  "needs-priority": "success",
  running: "info",
  armed: "info",
  waiting: "info",
  "pr-created": "info",
  review: "info",
  triaging: "info",
  reproduced: "info",
  diagnosed: "info",
  pending: "neutral",
  queued: "neutral",
  unreviewed: "neutral",
  draft: "neutral",
  cancelled: "neutral",
  "needs-triage": "neutral",
  open: "neutral",
  reviewed: "neutral",
  skipped: "neutral",
  "not-actionable": "neutral",
  failed: "danger",
  parked: "danger",
  blocked: "danger",
  changes_requested: "danger",
  "needs-reproduction": "danger",
  "unable-to-reproduce": "danger",
};

const TIME_AGO_UNITS: Array<[number, string]> = [
  [60 * 60 * 24 * 365, "year"],
  [60 * 60 * 24 * 30, "month"],
  [60 * 60 * 24, "day"],
  [60 * 60, "hour"],
  [60, "minute"],
];

interface LoopTableProps {
  /** The second column's heading: what this loop works. */
  subject: string;
  /** One `<tr>` per row; the table is absent, with `emptyText`, when there are none. */
  rows: readonly ReactNode[];
  emptyText: string;
  testId?: string;
}

export default function LoopTable(props: LoopTableProps) {
  const { subject, rows, emptyText, testId } = props;

  if (rows.length === 0) {
    return <Alert variant="secondary">{emptyText}</Alert>;
  }

  return (
    <PanelTable>
      <table className={styles.table} data-testid={testId ?? "loop-table"}>
        <TableHead subject={subject} />
        <tbody>{rows}</tbody>
      </table>
    </PanelTable>
  );
}

function TableHead({ subject }: { subject: string }) {
  return (
    <thead>
      <tr>
        <th className={styles.statusCol}>Status</th>
        <th>{subject}</th>
        <th>Stages</th>
        <th className={styles.actionsCol}>Actions</th>
      </tr>
    </thead>
  );
}

interface StatusCellProps {
  state: string;
  /** When the row entered its state; absent on a row the loop has not touched yet. */
  since: string | null;
  testId?: string;
}

/** The Status column: the state as a tone badge, and how long ago it was entered. */
export function StatusCell({ state, since, testId }: StatusCellProps) {
  const tone = STATUS_TONE[state] ?? "danger";

  return (
    <td>
      <span
        className={`${styles.statusBadge} ${styles[`tone_${tone}`]}`}
        data-testid={testId ?? "row-status"}
      >
        {state}
      </span>
      {since && (
        <span className={styles.timeAgo} title={since} data-testid="row-time">
          {timeAgo(since)}
        </span>
      )}
    </td>
  );
}

/** A small grey word beside the row's title: which kind of thing the row is. */
export function KindPill({ children }: { children: ReactNode }) {
  return <span className={styles.kind}>{children}</span>;
}

interface ActionsCellProps {
  runId: string | null;
  /** An external link and its button text, e.g. the pull request. */
  external?: { href: string; text: string } | null;
}

/** The Actions column: the run, and the thing on GitHub when there is one. */
export function ActionsCell({ runId, external }: ActionsCellProps) {
  return (
    <td className={styles.actionsCol}>
      {runId && (
        <a href={`/assembly-runs/${runId}`} className="button">
          Run
        </a>
      )}
      {external && <ExternalButton {...external} />}
    </td>
  );
}

function ExternalButton({ href, text }: { href: string; text: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="button">
      {text}
    </a>
  );
}

/** Relative time for the Status column; exported for its test. */
export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) {
    return "";
  }
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 1000),
  );

  if (seconds < 60) {
    return "just now";
  }
  const match = TIME_AGO_UNITS.find(([span]) => seconds >= span);

  return match ? formatTimeAgo(seconds, match[0], match[1]) : "";
}

function formatTimeAgo(seconds: number, span: number, unit: string): string {
  const n = Math.floor(seconds / span);

  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}
