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

        <label htmlFor="effective_date">
          Date it landed <span className="meta">— defaults to today</span>
        </label>
        <input id="effective_date" name="effective_date" type="date" />

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
