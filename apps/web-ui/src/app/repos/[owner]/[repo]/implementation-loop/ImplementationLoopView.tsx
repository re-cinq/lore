"use client";

import { Alert } from "@/components/Alert";
import MiniPipeline from "@/components/MiniPipeline";
import PendingActionButton from "@/components/PendingActionButton";
import type { ImplementationLoop, LoopTicket } from "@/lib/api/backlog";
import styles from "./ImplementationLoopView.module.scss";
import OnboardingBanner from "./OnboardingBanner";
import TicketTitleCell from "./TicketTitleCell";

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
  parked: "danger",
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

interface LoopViewProps {
  loop: ImplementationLoop;
  toggle: (next: { enabled: boolean }) => Promise<void>;
  /** Queues the repo's onboarding again, through the same guard the /onboard page uses. */
  retryOnboarding: () => Promise<void>;
}

/** Pure view (DDAU): data down as `loop`, toggle and retry up via bound server actions. */
export default function ImplementationLoopView(props: LoopViewProps) {
  const { loop, toggle, retryOnboarding } = props;

  return (
    <div>
      <LoopHeader enabled={loop.enabled} toggle={toggle} />
      <OnboardingBanner loop={loop} retry={retryOnboarding} />
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

/** What the loop is, and the one control that runs it. The button is disabled until the toggle's server action resolves, so a double click cannot send two conflicting toggles. */
function LoopHeader({ enabled, toggle }: LoopHeaderProps) {
  return (
    <div className={styles.header}>
      <p className="meta">
        The implementation loop works this repo&apos;s backlog one ticket at a
        time.
      </p>
      <PendingActionButton
        action={() => toggle({ enabled: !enabled })}
        text={enabled ? "Disable loop" : "Enable loop"}
        pendingText={enabled ? "Disabling…" : "Enabling…"}
        className=""
      />
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
      re-queue it. A ticket linked as blocked by an issue that is still open
      waits instead: it gets no label, and the loop picks it up once its last
      blocker closes. An issue carrying two priority labels is skipped until a
      human settles the ambiguity.
    </p>
  );
}

interface LoopSectionProps {
  heading: string;
  tickets: ImplementationLoop["next"];
  emptyText: string;
  /** What holds the whole section, said once above its rows. */
  notice?: string;
}

/** The stages of the backlog, in the order a ticket moves through them. Parked shows only when something is parked. */
function backlogStages(loop: ImplementationLoop): LoopSectionProps[] {
  return [
    {
      heading: "Current",
      tickets: loop.current ? [loop.current] : [],
      emptyText: "No ticket is being worked right now.",
    },
    { ...queueSection(loop), tickets: loop.next, emptyText: EMPTY_BACKLOG },
    ...(loop.parked.length > 0
      ? [{ heading: "Parked", tickets: loop.parked, emptyText: "" }]
      : []),
    {
      heading: "Recently addressed",
      tickets: loop.recent,
      emptyText: "Nothing addressed yet.",
    },
  ];
}

/** The queue's heading, and what holds all of it. "Next up" read as about to start while the loop was off or the repo not onboarded; onboarding has its own banner, so only the switched-off loop needs the notice. */
function queueSection(
  loop: ImplementationLoop,
): Pick<LoopSectionProps, "heading" | "notice"> {
  if (!loop.enabled) {
    return {
      heading: "Paused: the loop is switched off",
      notice:
        "Nothing is picked until the loop is enabled. Use Enable loop above.",
    };
  }

  return {
    heading: loop.onboarding.merged ? "Next up" : "Waiting for onboarding",
  };
}

/** One stage of the backlog. Each empty text says what would put a ticket here rather than just "none", because an empty section usually means the reader has something to do. */
function LoopSection(props: LoopSectionProps) {
  const { heading, tickets, emptyText, notice } = props;

  return (
    <section className={styles.section}>
      <h2>{heading}</h2>
      {notice && (
        <p
          className={`meta ${styles.sectionNotice}`}
          data-testid="section-notice"
        >
          {notice}
        </p>
      )}
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
        {ticket.pipeline && ticket.run_id && (
          <MiniPipeline runId={ticket.run_id} pipeline={ticket.pipeline} />
        )}
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
