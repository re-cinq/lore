"use client";

import { Alert } from "@/components/Alert";
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

const TIME_AGO_UNITS: Array<[number, string]> = [
  [60 * 60 * 24 * 365, "year"],
  [60 * 60 * 24 * 30, "month"],
  [60 * 60 * 24, "day"],
  [60 * 60, "hour"],
  [60, "minute"],
];

const EMPTY_BACKLOG =
  "The backlog is empty. Label an issue priority:high, priority:medium, or priority:low to queue it.";

/** Tone per node state: unrecognised renders as failed-red so new outcomes are loud. */
const DOT_STATES = new Set([
  "success",
  "running",
  "waiting",
  "pending",
  "changes_requested",
]);

type PipelineNode = NonNullable<LoopTicket["pipeline"]>[number];

interface LoopViewProps {
  loop: ImplementationLoop;
  toggle: (next: { enabled: boolean }) => Promise<void>;
}

/** Pure view (DDAU): data down as `loop`, toggle up via bound server action. */
export default function ImplementationLoopView(props: LoopViewProps) {
  const { loop, toggle } = props;

  return (
    <div>
      <LoopHeader enabled={loop.enabled} toggle={toggle} />
      <LoopExplainer />

      {backlogStages(loop).map((stage) => (
        <LoopSection key={stage.heading} {...stage} />
      ))}
    </div>
  );
}

interface LoopHeaderProps {
  enabled: boolean;
  toggle: (next: { enabled: boolean }) => Promise<void>;
}

/** What the loop is, and the one control that runs it. The button is disabled for the length of the transition so a double click cannot send two conflicting toggles. */
function LoopHeader({ enabled, toggle }: LoopHeaderProps) {
  const [pending, startTransition] = useTransition();

  return (
    <div className={styles.header}>
      <p className="meta">
        The implementation loop works this repo&apos;s backlog one ticket at a
        time.
      </p>
      <button
        className="button"
        disabled={pending}
        onClick={() => startTransition(() => toggle({ enabled: !enabled }))}
      >
        {enabled ? "Disable loop" : "Enable loop"}
      </button>
    </div>
  );
}

/** How a ticket enters the loop and what it does with it. Kept beside the queues because the priority label IS the whole opt-in, and a reader looking at an empty backlog needs to know that before anything appears. */
function LoopExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      Label an open issue with exactly one of <code>priority:high</code>,{" "}
      <code>priority:medium</code>, or <code>priority:low</code> to queue it —
      the label is the whole opt-in. While the loop is enabled it picks the
      highest-priority ticket (oldest first on ties), implements it test-first,
      opens a pull request, and waits until that PR is green with every review
      thread resolved before picking the next. It never merges — a human does
      that, whenever they like. A ticket that gets stuck is labelled{" "}
      <code>lore:blocked</code> with a comment saying why; remove the label to
      re-queue it. An issue carrying two priority labels is skipped until a
      human settles the ambiguity.
    </p>
  );
}

interface LoopSectionProps {
  heading: string;
  tickets: ImplementationLoop["next"];
  emptyText: string;
}

/** The three stages of the backlog, in the order a ticket moves through them. */
function backlogStages(loop: ImplementationLoop): LoopSectionProps[] {
  return [
    {
      heading: "Current",
      tickets: loop.current ? [loop.current] : [],
      emptyText: "No ticket is being worked right now.",
    },
    {
      heading: "Next up",
      tickets: loop.next,
      emptyText: EMPTY_BACKLOG,
    },
    {
      heading: "Recently addressed",
      tickets: loop.recent,
      emptyText: "Nothing addressed yet.",
    },
  ];
}

/** One stage of the backlog. Each empty text says what would put a ticket here rather than just "none", because an empty section usually means the reader has something to do. */
function LoopSection({ heading, tickets, emptyText }: LoopSectionProps) {
  return (
    <section className={styles.section}>
      <h2>{heading}</h2>
      <TicketTable tickets={tickets} emptyText={emptyText} />
    </section>
  );
}

interface TicketTableProps {
  tickets: LoopTicket[];
  emptyText: string;
}

function TicketTable({ tickets, emptyText }: TicketTableProps) {
  if (tickets.length === 0) {
    return <Alert variant="secondary">{emptyText}</Alert>;
  }

  return (
    <table className={styles.ticketTable} data-testid="ticket-table">
      <TicketTableHead />
      <tbody>
        {tickets.map((ticket, i) => (
          <TicketRow key={`${ticket.issue_number}-${i}`} ticket={ticket} />
        ))}
      </tbody>
    </table>
  );
}

function TicketTableHead() {
  return (
    <thead>
      <tr>
        <th className={styles.statusCol}>Status</th>
        <th>Ticket</th>
        <th>Stages</th>
        <th className={styles.actionsCol}>Actions</th>
      </tr>
    </thead>
  );
}

function TicketRow({ ticket }: { ticket: LoopTicket }) {
  return (
    <tr data-testid="ticket-row">
      <TicketStatusCell ticket={ticket} />
      <TicketTitleCell ticket={ticket} />
      <td>
        <MiniPipeline ticket={ticket} />
      </td>
      <TicketActionsCell ticket={ticket} />
    </tr>
  );
}

function TicketStatusCell({ ticket }: { ticket: LoopTicket }) {
  const tone = STATUS_TONE[ticket.state] ?? "danger";

  return (
    <td>
      <span
        className={`${styles.statusBadge} ${styles[`tone_${tone}`]}`}
        data-testid="ticket-status"
      >
        {ticket.state}
      </span>
      <TicketTime ticket={ticket} />
    </td>
  );
}

/** When the ticket entered its current state. Absent on a ticket the loop has not touched yet. */
function TicketTime({ ticket }: { ticket: LoopTicket }) {
  if (!ticket.created_at) {
    return null;
  }

  return (
    <span
      className={styles.timeAgo}
      title={ticket.created_at}
      data-testid="ticket-time"
    >
      {timeAgo(ticket.created_at)}
    </span>
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

function TicketTitleCell({ ticket }: { ticket: LoopTicket }) {
  return (
    <td>
      <TicketLink ticket={ticket} />
      {ticket.priority && (
        <span className={styles.priority}>{ticket.priority}</span>
      )}
      <TicketError ticket={ticket} />
    </td>
  );
}

/** The issue reference, linked out when the ticket knows its issue URL. */
function TicketLink({ ticket }: { ticket: LoopTicket }) {
  const label = `#${ticket.issue_number} ${ticket.title}`;

  return ticket.issue_url ? (
    <a href={ticket.issue_url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

/** Why the loop could not finish the ticket, shown inline so a blocked ticket explains itself. */
function TicketError({ ticket }: { ticket: LoopTicket }) {
  if (!ticket.error) {
    return null;
  }

  return (
    <p
      className={styles.errorLine}
      title={ticket.error}
      data-testid={`ticket-error-${ticket.issue_number}`}
    >
      {ticket.error}
    </p>
  );
}

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
        <PipelineDot key={node.node_id} node={node} />
      ))}
    </a>
  );
}

function PipelineDot({ node }: { node: PipelineNode }) {
  const state = DOT_STATES.has(node.state) ? node.state : "failed";

  return (
    <span
      title={`${node.node_id}: ${node.state}`}
      data-testid={`mini-node-${node.node_id}`}
      className={`${styles.dot} ${styles[state as keyof typeof styles]}`}
    />
  );
}

function TicketActionsCell({ ticket }: { ticket: LoopTicket }) {
  return (
    <td className={styles.actionsCol}>
      {ticket.run_id && (
        <a href={`/assembly-runs/${ticket.run_id}`} className="button">
          Run
        </a>
      )}
      <TicketPrLink ticket={ticket} />
    </td>
  );
}

function TicketPrLink({ ticket }: { ticket: LoopTicket }) {
  if (!ticket.pr_url) {
    return null;
  }

  return (
    <a href={ticket.pr_url} target="_blank" rel="noreferrer" className="button">
      PR
    </a>
  );
}
