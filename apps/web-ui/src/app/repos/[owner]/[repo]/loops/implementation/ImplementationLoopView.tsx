"use client";

import MiniPipeline from "@/components/MiniPipeline";
import type { ImplementationLoop, LoopTicket } from "@/lib/api/backlog";
import Panel from "@/components/Panel";
import LoopTable, { ActionsCell, StatusCell } from "../LoopTable";
import styles from "./ImplementationLoopView.module.scss";
import OnboardingBanner from "./OnboardingBanner";
import TicketTitleCell from "./TicketTitleCell";

const EMPTY_BACKLOG =
  "The backlog is empty. Label an issue priority:high, priority:medium, or priority:low to queue it.";

interface LoopViewProps {
  loop: ImplementationLoop;
  /** Queues the repo's onboarding again, through the same guard the /onboard page uses. */
  retryOnboarding: () => Promise<void>;
}

/** Pure view (DDAU): data down as `loop`, retry up via a bound server action. The loop's switch sits above it on the Loops tab. */
export default function ImplementationLoopView(props: LoopViewProps) {
  const { loop, retryOnboarding } = props;

  return (
    <div>
      <OnboardingBanner loop={loop} retry={retryOnboarding} />
      <LoopExplainer />

      <div className={styles.sections}>
        {backlogStages(loop).map((stage) => (
          <LoopSection key={stage.heading} {...stage} />
        ))}
      </div>
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

/** The stages of the backlog, in the order a ticket moves through them. Parked and Awaiting merge show only when they would hold a ticket. */
function backlogStages(loop: ImplementationLoop): LoopSectionProps[] {
  return [
    {
      heading: "Current",
      tickets: loop.current,
      emptyText: "No ticket is being worked right now.",
    },
    { ...queueSection(loop), tickets: loop.next, emptyText: EMPTY_BACKLOG },
    ...optionalStage("Parked", loop.parked),
    ...optionalStage("Awaiting merge", loop.awaiting_merge),
    {
      heading: "Recently addressed",
      tickets: loop.recent,
      emptyText: "Nothing addressed yet.",
    },
  ];
}

/** A stage that is absent entirely rather than rendered empty. */
function optionalStage(
  heading: string,
  tickets: LoopTicket[],
): LoopSectionProps[] {
  return tickets.length > 0 ? [{ heading, tickets, emptyText: "" }] : [];
}

/** The queue's heading, and what holds all of it. "Next up" read as about to start while the loop was off or the repo not onboarded; onboarding has its own banner, so only the switched-off loop needs the notice. */
function queueSection(
  loop: ImplementationLoop,
): Pick<LoopSectionProps, "heading" | "notice"> {
  if (!loop.enabled) {
    return {
      heading: "Paused: the loop is switched off",
      notice: "Nothing is picked until the loop is switched on above.",
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
    <Panel title={heading}>
      {notice && (
        <p
          className={`meta ${styles.sectionNotice}`}
          data-testid="section-notice"
        >
          {notice}
        </p>
      )}
      <TicketTable tickets={tickets} emptyText={emptyText} />
    </Panel>
  );
}

function TicketTable({
  tickets,
  emptyText,
}: {
  tickets: LoopTicket[];
  emptyText: string;
}) {
  return (
    <LoopTable
      subject="Ticket"
      emptyText={emptyText}
      testId="ticket-table"
      rows={tickets.map((ticket, i) => (
        <TicketRow key={`${ticket.issue_number}-${i}`} ticket={ticket} />
      ))}
    />
  );
}

function TicketRow({ ticket }: { ticket: LoopTicket }) {
  return (
    <tr data-testid="ticket-row">
      <StatusCell
        state={ticket.state}
        since={ticket.created_at}
        testId="ticket-status"
      />
      <TicketTitleCell ticket={ticket} />
      <td>
        {ticket.pipeline && ticket.run_id && (
          <MiniPipeline runId={ticket.run_id} pipeline={ticket.pipeline} />
        )}
      </td>
      <ActionsCell runId={ticket.run_id} external={pullLink(ticket)} />
    </tr>
  );
}

function pullLink(ticket: LoopTicket) {
  return ticket.pr_url ? { href: ticket.pr_url, text: "PR" } : null;
}
