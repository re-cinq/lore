import styles from "./SpendView.module.css";
import type { SpendWindow, SpendViewProps, BudgetRow } from "./SpendView";
import RecordTopUp from "./RecordTopUp";
import {
  usd,
  num,
  day,
  anchorDay,
  anchorTime,
  budgetOutlook,
} from "./spend-format";

/** Projection line: renders only when budgetOutlook projects. */
function BudgetOutlookNote({ budget }: { budget: NonNullable<BudgetRow> }) {
  const outlook = budgetOutlook(budget, new Date());

  if (!outlook) {
    return null;
  }

  // "about 1 days left" is the line a person reads on the day it matters most.
  const runout =
    outlook.daysLeft === 1
      ? "about a day left at that rate"
      : `about ${num(outlook.daysLeft)} days left at that rate`;

  return (
    <div className={`meta ${styles.subnote}`}>
      ≈{usd(outlook.burnPerDay)}/day —{" "}
      {budget.remaining_usd < 0 ? "already over the recorded balance" : runout}
    </div>
  );
}

/** An em dash, not $0.00. An unrecorded balance is not an exhausted one, and the difference matters: one of them means someone has to go and enter a figure. */
function NoBalanceRecorded() {
  return (
    <div className={`spec-card ${styles.balanceCard}`}>
      <div className="meta">Credits remaining</div>
      <div className={styles.figure}>—</div>
      <div className={`meta ${styles.subnote}`}>
        No balance recorded yet. Anthropic publishes usage and cost but not a
        credit balance, so the starting figure has to be entered once.
      </div>
    </div>
  );
}

/** The recorded balance, or an em dash. Deliberately NOT $0.00 when nothing has been recorded: an unrecorded balance is not an exhausted one, and Anthropic publishes usage and cost but no credit figure, so the starting number has to be entered by hand once. */
function BalanceCard({ budget }: { budget: SpendWindow["budget"] }) {
  if (!budget) {
    return <NoBalanceRecorded />;
  }

  return (
    <div className={`spec-card ${styles.balanceCard}`}>
      <div className="meta">Credits remaining</div>
      <div
        className={
          budget.remaining_usd < 0 ? styles.figureOver : styles.figureInfo
        }
      >
        {usd(budget.remaining_usd)}
      </div>
      {/* Clock only if the anchor carries one; a day-recorded entry does not show 00:00. */}
      <div className={`meta ${styles.subnote}`}>
        {usd(budget.ledger_total_usd)} recorded − {usd(budget.spent_since_usd)}{" "}
        spent since {day(anchorDay(budget.anchored_at))}
        {anchorTime(budget.anchored_at)
          ? `, ${anchorTime(budget.anchored_at)} UTC`
          : ""}
      </div>
      <BudgetOutlookNote budget={budget} />
    </div>
  );
}

/** What is left of the recorded credits. Not interval-scoped: money persists, so this subtracts spend since the anchor from the amount on record. */
export function BalanceSection({
  budget,
  hasClusterSpend,
  recordAction,
}: {
  budget: SpendWindow["budget"];
  hasClusterSpend: boolean;
  recordAction?: SpendViewProps["recordAction"];
}) {
  return (
    <>
      {/* Balance: not scoped to interval (money persists); subtract spend from recorded amount */}
      <h2>Balance</h2>
      <div className={styles.cards}>
        <BalanceCard budget={budget} />
      </div>
      {hasClusterSpend && (
        <p className={`meta ${styles.subnote}`}>
          Cluster spend shown below is excluded from this balance: a satellite
          runs on its own credential and does not draw these credits.
        </p>
      )}
      {recordAction && (
        <RecordTopUp first={!budget} recordAction={recordAction} />
      )}
    </>
  );
}
