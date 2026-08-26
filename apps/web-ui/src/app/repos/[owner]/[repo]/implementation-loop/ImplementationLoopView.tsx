"use client";

import { useTransition } from "react";
import type { ImplementationLoop, LoopTicket } from "@/lib/api/backlog";
import styles from "./ImplementationLoopView.module.scss";

/** GitLab-pipelines-style status tones, keyed on the ticket's task status. */
const STATUS_TONE: Record<string, "success" | "danger" | "info" | "neutral"> = {
  completed: "success",
  merged: "success",
  running: "info",
  "pr-created": "info",
  review: "info",
  pending: "neutral",
  queued: "neutral",
  failed: "danger",
  cancelled: "neutral",
};

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
  const table: Array<[number, string]> = [
    [60 * 60 * 24 * 365, "year"],
    [60 * 60 * 24 * 30, "month"],
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
  ];

  for (const [span, unit] of table) {
    if (seconds >= span) {
      const n = Math.floor(seconds / span);

      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  // Reachable by construction: the early return handled < 60s, the loop
  // handled >= 1h, so what is left is always minutes.
  const minutes = Math.floor(seconds / 60);

  return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

/** Pure view (DDAU): data down as `loop`, the toggle back up through the bound
 *  server action. No I/O here — the container fetches, the action writes. */
export default function ImplementationLoopView({
  loop,
  toggle,
}: {
  loop: ImplementationLoop;
  toggle: (enabled: boolean) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <div className={styles.header}>
        <p className="meta">
          The implementation loop works this repo&apos;s backlog one ticket at a
          time.
        </p>
        <button
          className="button"
          disabled={pending}
          onClick={() => startTransition(() => toggle(!loop.enabled))}
        >
          {loop.enabled ? "Disable loop" : "Enable loop"}
        </button>
      </div>

      <p className={`meta ${styles.howTo}`}>
        Label an open issue with exactly one of <code>priority:high</code>,{" "}
        <code>priority:medium</code>, or <code>priority:low</code> to queue it —
        the label is the whole opt-in. While the loop is enabled it picks the
        highest-priority ticket (oldest first on ties), implements it
        test-first, opens a pull request, and waits until that PR is green with
        every review thread resolved before picking the next. It never merges —
        a human does that, whenever they like. A ticket that gets stuck is
        labelled <code>lore:blocked</code> with a comment saying why; remove the
        label to re-queue it. An issue carrying two priority labels is skipped
        until a human settles the ambiguity.
      </p>

      <section className={styles.section}>
        <h2>Current</h2>
        <TicketTable
          tickets={loop.current ? [loop.current] : []}
          emptyText="No ticket is being worked right now."
        />
      </section>

      <section className={styles.section}>
        <h2>Next up</h2>
        <TicketTable
          tickets={loop.next}
          emptyText="The backlog is empty. Label an issue priority:high, priority:medium, or priority:low to queue it."
        />
      </section>

      <section className={styles.section}>
        <h2>Recently addressed</h2>
        <TicketTable tickets={loop.recent} emptyText="Nothing addressed yet." />
      </section>
    </div>
  );
}

function TicketTable({
  tickets,
  emptyText,
}: {
  tickets: LoopTicket[];
  emptyText: string;
}) {
  if (tickets.length === 0) {
    return <p className="meta">{emptyText}</p>;
  }

  return (
    <table className={styles.ticketTable} data-testid="ticket-table">
      <thead>
        <tr>
          <th className={styles.statusCol}>Status</th>
          <th>Ticket</th>
          <th>Stages</th>
          <th className={styles.actionsCol}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {tickets.map((ticket, i) => (
          <TicketRow key={`${ticket.issue_number}-${i}`} ticket={ticket} />
        ))}
      </tbody>
    </table>
  );
}

function TicketRow({ ticket }: { ticket: LoopTicket }) {
  const tone = STATUS_TONE[ticket.state] ?? "danger";

  return (
    <tr data-testid="ticket-row">
      <td>
        <span
          className={`${styles.statusBadge} ${styles[`tone_${tone}`]}`}
          data-testid="ticket-status"
        >
          {ticket.state}
        </span>
        {ticket.created_at && (
          <span
            className={styles.timeAgo}
            title={ticket.created_at}
            data-testid="ticket-time"
          >
            {timeAgo(ticket.created_at)}
          </span>
        )}
      </td>
      <td>
        {ticket.issue_url ? (
          <a href={ticket.issue_url} target="_blank" rel="noreferrer">
            #{ticket.issue_number} {ticket.title}
          </a>
        ) : (
          <span>
            #{ticket.issue_number} {ticket.title}
          </span>
        )}
        {ticket.priority && (
          <span className={styles.priority}>{ticket.priority}</span>
        )}
        {ticket.error && (
          <p
            className={styles.errorLine}
            title={ticket.error}
            data-testid="ticket-error"
          >
            {ticket.error}
          </p>
        )}
      </td>
      <td>
        <MiniPipeline ticket={ticket} />
      </td>
      <td className={styles.actionsCol}>
        {ticket.run_id && (
          <a href={`/assembly-runs/${ticket.run_id}`} className="button">
            Run
          </a>
        )}
        {ticket.pr_url && (
          <a
            href={ticket.pr_url}
            target="_blank"
            rel="noreferrer"
            className="button"
          >
            PR
          </a>
        )}
      </td>
    </tr>
  );
}

/** Tone per node state; anything unrecognised renders as failed-red so a new
 *  outcome is loud rather than invisible. */
const DOT_STATES = new Set([
  "success",
  "running",
  "waiting",
  "pending",
  "changes_requested",
]);

function MiniPipeline({ ticket }: { ticket: LoopTicket }) {
  if (!ticket.pipeline || !ticket.run_id) {
    return null;
  }

  return (
    <a
      className={styles.miniPipeline}
      href={`/assembly-runs/${ticket.run_id}`}
      title="Open the live run"
      data-testid="mini-pipeline"
    >
      {ticket.pipeline.map((node) => (
        <span
          key={node.node_id}
          title={`${node.node_id}: ${node.state}`}
          data-testid={`mini-node-${node.node_id}`}
          className={`${styles.dot} ${
            styles[
              DOT_STATES.has(node.state)
                ? (node.state as keyof typeof styles)
                : "failed"
            ]
          }`}
        />
      ))}
    </a>
  );
}
