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
          time: highest priority first, PR opened, never merged by Lore.
        </p>
        <button
          className="button"
          disabled={pending}
          onClick={() => startTransition(() => toggle(!loop.enabled))}
        >
          {loop.enabled ? "Disable loop" : "Enable loop"}
        </button>
      </div>

      <section className={styles.section}>
        <h2>Current</h2>
        {loop.current ? (
          <Ticket ticket={loop.current} />
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
