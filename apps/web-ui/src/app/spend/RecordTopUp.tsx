"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import type { RecordTopUpState } from "./actions";
import styles from "./SpendView.module.css";

// The only interactive thing on this screen, split out so SpendView stays a
// server component: a form needs a client boundary, and pulling the whole view
// across one would ship every figure's formatting to the browser for nothing.

export interface RecordTopUpProps {
  /** True when the ledger is empty, which changes what this form is FOR: the
   *  first entry is an opening balance read off the Anthropic console, not a
   *  top-up, and asking for "the amount added" would collect the wrong number. */
  first: boolean;
  recordAction: (
    prev: RecordTopUpState | null,
    formData: FormData,
  ) => Promise<RecordTopUpState>;
}

export default function RecordTopUp({ first, recordAction }: RecordTopUpProps) {
  const [state, formAction] = useActionState(recordAction, null);

  return (
    <details className={styles.recordDetails}>
      <summary>{first ? "Record the balance" : "Record a top-up"}</summary>
      <form action={formAction} className={styles.recordForm}>
        <p className={`meta ${styles.subnote}`}>
          {first
            ? "Anthropic has no balance API, so the starting figure has to come from a person. Read the current credit balance off the Anthropic console and enter it here once; after that, record each top-up as it happens."
            : "Enter the amount added. Spend is counted from the earliest entry, so the remaining figure updates as soon as this is saved."}
        </p>

        <label htmlFor="amount_usd">Amount (USD)</label>
        <input
          id="amount_usd"
          name="amount_usd"
          type="number"
          step="0.01"
          placeholder="100"
          required
          autoComplete="off"
        />

        {/* "Defaults to today" was ambiguous: a reader could equally take it
            as "defaults to now", and those anchor the arithmetic at opposite
            ends of a day's spend. The label now states the consequence rather
            than the default. */}
        <label htmlFor="effective_date">
          Date it landed{" "}
          <span className="meta">— blank counts from the start of today</span>
        </label>
        <input id="effective_date" name="effective_date" type="date" />

        <label htmlFor="effective_time">
          Time it landed{" "}
          <span className="meta">
            — optional; blank counts from the start of the day
          </span>
        </label>
        <input id="effective_time" name="effective_time" type="time" />

        <label htmlFor="note">
          Note <span className="meta">— optional</span>
        </label>
        <input
          id="note"
          name="note"
          type="text"
          placeholder="who added it, invoice reference…"
          autoComplete="off"
        />

        {first && <input type="hidden" name="kind" value="opening" />}

        {/* The rules are stated on the form rather than left to be inferred
            from the figures. Two of them are counter-intuitive enough to have
            been got wrong during this feature's own review: a blank date is
            NOT "now", and a late-recorded top-up needs no accurate timestamp
            at all. */}
        <dl className={styles.legend}>
          <dt>Amount</dt>
          <dd>
            Dollars added. A negative amount is recorded as a correction, which
            is how a mistyped entry is undone — nothing is ever overwritten.
          </dd>

          <dt>Date and time</dt>
          <dd>
            When the money <em>landed</em>, not when you typed it in. Blank
            counts from the start of today; a date counts from the start of that
            day; adding a time counts from that exact moment. Leaving the time
            out can only ever count more spend against the balance, never less.
          </dd>

          <dt>Which entry moves the window</dt>
          <dd>
            Only the opening entry decides where counting starts. Later top-ups
            add to the total and nothing else, so recording one days late still
            gives the right figure — the amount is the part that must be
            correct.
          </dd>
        </dl>

        <div className={styles.recordActions}>
          <SubmitButton pendingLabel="Recording…">
            {first ? "Record balance" : "Record top-up"}
          </SubmitButton>
          {state?.error && <span className="meta">{state.error}</span>}
          {state?.recorded && <span className="meta">{state.recorded}</span>}
        </div>
      </form>
    </details>
  );
}
