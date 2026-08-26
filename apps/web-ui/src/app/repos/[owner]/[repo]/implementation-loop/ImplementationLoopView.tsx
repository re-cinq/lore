"use client";

import { useTransition } from "react";
import type { ImplementationLoop, LoopTicket } from "@/lib/api/backlog";
import styles from "./ImplementationLoopView.module.scss";

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
        {loop.current ? (
          <>
            <Ticket ticket={loop.current} />
            {loop.current_run_id && (
              <p className="meta">
                <a href={`/assembly-runs/${loop.current_run_id}`}>
                  Live pipeline view →
                </a>
              </p>
            )}
          </>
        ) : (
          <p className="meta">No ticket is being worked right now.</p>
        )}
      </section>

      <section className={styles.section}>
        <h2>Next up</h2>
        {loop.next.length === 0 ? (
          <p className="meta">
            The backlog is empty. Label an issue priority:high, priority:medium,
            or priority:low to queue it.
          </p>
        ) : (
          loop.next.map((t) => <Ticket key={t.issue_number} ticket={t} />)
        )}
      </section>

      <section className={styles.section}>
        <h2>Recently addressed</h2>
        {loop.recent.length === 0 ? (
          <p className="meta">Nothing addressed yet.</p>
        ) : (
          loop.recent.map((t) => <Ticket key={t.issue_number} ticket={t} />)
        )}
      </section>
    </div>
  );
}

function Ticket({ ticket }: { ticket: LoopTicket }) {
  return (
    <div className={styles.ticket}>
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
      {ticket.pr_url && (
        <a href={ticket.pr_url} target="_blank" rel="noreferrer">
          PR
        </a>
      )}
      <span className={styles.state}>{ticket.state}</span>
    </div>
  );
}
