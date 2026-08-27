import styles from "./SpendView.module.css";
import type { components } from "@/lib/api/schema";
import RecordTopUp from "./RecordTopUp";
import type { RecordTopUpState } from "./actions";

// Anthropic's authoritative billed cost (Admin Cost API → anthropic_cost_daily).
// Optional — only present when an sk-ant-admin… key is configured.
// Every row here is an alias over the OpenAPI document lore-api generates from
// the /api/spend contract (ADR-035). None of these shapes comes from a table —
// they are SQL aggregates — so the contract is stated beside the queries that
// produce them, and this file reads it rather than restating it.

type Spend = components["schemas"]["Spend"];

export type OrgMtdRow = Spend["org_mtd"];
export type OrgByModelRow = Spend["org_by_model"][number];
export type OrgDailyRow = Spend["org_daily"][number];
export type LoreMtdRow = Spend["lore_mtd"];
export type LoreByModelRow = Spend["lore_by_model"][number];
export type LoreByKindRow = Spend["lore_by_kind"][number];
export type LoreDailyRow = Spend["lore_daily"][number];
export type LoreByRepoRow = Spend["lore_by_repo"][number];
export type LoreByTaskTypeRow = Spend["lore_by_task_type"][number];
export type LoreByClusterRow = Spend["lore_by_cluster"][number];

export type BudgetRow = Spend["budget"];

export interface SpendViewProps {
  /**
   * What is LEFT of the recorded balance, or null when nobody has recorded
   * one. Null renders a prompt to record it, never a confident "$0.00
   * remaining" — an unrecorded balance and an exhausted one are different
   * facts and only one of them is a number.
   *
   * Optional, like the unbilled figures below and for the same reason: a
   * caller that does not pass it renders exactly as before.
   */
  budget?: BudgetRow;
  /** Records money added. Omitted → the form is not rendered; the figures are
   *  read-only either way. */
  recordAction?: (
    prev: RecordTopUpState | null,
    formData: FormData,
  ) => Promise<RecordTopUpState>;
  orgMtd: OrgMtdRow;
  orgAvailable: boolean;
  /**
   * Lore-computed spend for every day Anthropic has not billed yet, and how
   * many days that is. Usually one — the cost report never emits the day in
   * progress — but a sync that ran late, failed, or has not run yet leaves
   * more, and the previous today-only figure could not say so: it named a
   * one-day gap while whole days sat in neither number. `llm_calls` is
   * token-exact against Anthropic's hourly usage report. Optional so callers
   * without them render exactly as before.
   */
  loreUnbilledUsd?: number;
  loreUnbilledDays?: number;
  orgByModel: OrgByModelRow[];
  orgDaily: OrgDailyRow[];
  loreMtd: LoreMtdRow;
  loreByModel: LoreByModelRow[];
  loreByKind: LoreByKindRow[];
  loreDaily: LoreDailyRow[];
  loreByRepo: LoreByRepoRow[];
  loreByTaskType: LoreByTaskTypeRow[];
  /**
   * Computed spend per execution cluster — a satellite cluster's burn set
   * apart from the home cluster's. Optional so a caller that does not pass it
   * renders exactly as before.
   */
  loreByCluster?: LoreByClusterRow[];
}

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

/**
 * A `YYYY-MM-DD` calendar day rendered day-month-year.
 *
 * Formatted from the string's own parts, never through `new Date`: parsing
 * `"2026-08-18"` yields UTC midnight, which renders as the 17th for every
 * viewer west of Greenwich — a date that is simply wrong for half the people
 * reading it.
 *
 * Day-month-year is a DELIBERATE locale override, not an accident of where it
 * was written. `toLocaleDateString` renders the same day differently for two
 * people reading this page together — `08-09` is the 8th of September to one
 * and the 9th of August to the other — and a spend figure people compare out
 * loud cannot afford that. One fixed order, the same for every viewer.
 */
const day = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-");

  return `${d}-${m}-${y}`;
};

/** A timestamp as day-month-year plus a 24-hour clock, for the same reasons. */
const stamp = (iso: string) => {
  const t = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${pad(t.getDate())}-${pad(t.getMonth() + 1)}-${t.getFullYear()} ` +
    `${pad(t.getHours())}:${pad(t.getMinutes())}`
  );
};

const MS_PER_DAY = 86_400_000;

/** Local midnight for a `YYYY-MM-DD` day, for the reason `day` gives. */
const midnight = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-").map(Number);

  return new Date(y, m - 1, d);
};

/**
 * The anchor arrives as an ISO-8601 UTC instant. Its leading 10 characters are
 * the calendar day, taken as a STRING rather than via `new Date`, because
 * every other day on this page is handled that way and for the same reason:
 * parsing puts it at UTC midnight, which renders as the previous day for every
 * viewer west of Greenwich.
 */
const anchorDay = (anchoredAt: string) => anchoredAt.slice(0, 10);

/** The clock part, or null when the entry anchors to the start of its day —
 *  which is what a date without a known time records. */
const anchorTime = (anchoredAt: string) => {
  const clock = anchoredAt.slice(11, 16);

  return !clock || clock === "00:00" ? null : clock;
};

/**
 * Average daily burn since the anchor, and how many days the remaining balance
 * covers at that rate — the part that answers "are we running low", which is
 * the question a bare remaining figure leaves open.
 *
 * `today` is a parameter rather than a `new Date()` inside, so the arithmetic
 * is testable without freezing a clock.
 *
 * Null whenever a projection would be a guess dressed as a number: an anchor
 * in the future, or no spend yet to average. Day differences are ROUNDED, not
 * floored — a daylight-saving boundary makes a calendar day 23 or 25 hours
 * long, and flooring that silently loses a day from the divisor.
 */
export function budgetOutlook(
  budget: NonNullable<BudgetRow>,
  today: Date,
): { burnPerDay: number; daysLeft: number } | null {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const elapsedDays =
    Math.round(
      (startOfToday.getTime() -
        midnight(anchorDay(budget.anchored_at)).getTime()) /
        MS_PER_DAY,
    ) + 1;

  if (elapsedDays < 1 || budget.spent_since_usd <= 0) {
    return null;
  }
  const burnPerDay = budget.spent_since_usd / elapsedDays;

  return {
    burnPerDay,
    daysLeft: Math.max(0, Math.floor(budget.remaining_usd / burnPerDay)),
  };
}

/**
 * The projection line, split out so the one `new Date()` this view needs has a
 * single home. Renders nothing when `budgetOutlook` declines to project.
 */
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

export default function SpendView({
  budget,
  recordAction,
  orgMtd,
  orgAvailable,
  loreUnbilledUsd,
  loreUnbilledDays,
  orgByModel,
  orgDaily,
  loreMtd,
  loreByModel,
  loreByKind,
  loreDaily,
  loreByRepo,
  loreByTaskType,
  loreByCluster,
}: SpendViewProps) {
  return (
    <div>
      <h1>Claude API Spend</h1>
      <p className={`meta ${styles.subnote}`}>
        Figures are Lore-computed from <code>pipeline.llm_calls</code> token
        counts (input/output × per-model pricing, cache-adjusted).
        Anthropic&apos;s authoritative billed total needs an admin key and
        appears only when one is configured.
      </p>

      <h2>Month to Date</h2>
      <div className={styles.cards}>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Lore-computed cost</div>
          <div className={styles.figureInfo}>{usd(loreMtd.computed_usd)}</div>
          <div className={`meta ${styles.subnote}`}>
            estimate from token counts
          </div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">API calls</div>
          <div className={styles.figure}>{num(loreMtd.calls)}</div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Input tokens</div>
          <div className={styles.figure}>{num(loreMtd.input_tokens)}</div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Output tokens</div>
          <div className={styles.figure}>{num(loreMtd.output_tokens)}</div>
        </div>
        {orgAvailable && (
          <div className={`spec-card ${styles.card}`}>
            <div className="meta">Billed cost (Anthropic)</div>
            <div className={styles.figure}>{usd(orgMtd.billed_usd)}</div>
            <div className={`meta ${styles.subnote}`}>
              as of {stamp(orgMtd.as_of as string)}
            </div>
            {/* Anthropic's cost report never includes the in-progress day, so
                the billed figure always trails. Surface the remainder
                separately and labeled rather than folding it in: the sum would
                silently mix an authoritative number with a computed one. The
                span is read from `billed_through`, never assumed to be one day
                — assuming it is what made this line understate the gap by a
                whole day's spend whenever the sync fell behind. */}
            {loreUnbilledUsd !== undefined && loreUnbilledUsd > 0 && (
              <div className={`meta ${styles.subnote}`}>
                {orgMtd.billed_through
                  ? `billed through ${day(orgMtd.billed_through)}`
                  : "not yet billed"}{" "}
                — + {usd(loreUnbilledUsd)}{" "}
                {loreUnbilledDays === 1
                  ? "today"
                  : `over ${num(loreUnbilledDays ?? 0)} days since`}{" "}
                (Lore-computed)
              </div>
            )}
          </div>
        )}
      </div>

      {loreByCluster && (
        <>
          <h2>Cost by Cluster (MTD)</h2>
          <table>
            <thead>
              <tr>
                <th>Cluster</th>
                <th>Calls</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {/* Two honest groups: the null bucket is the home account's own
                  spend (no cluster-agent claim), the rest are registered
                  clusters. A satellite here bills to its own credential, so its
                  spend does not touch the balance below. */}
              {loreByCluster.some((r) => r.cluster === null) && (
                <tr>
                  <td colSpan={3} className={styles.subhead}>
                    Non-cluster
                  </td>
                </tr>
              )}
              {loreByCluster
                .filter((r) => r.cluster === null)
                .map((r) => (
                  <tr key="no-cluster">
                    <td>
                      <span className="badge">(no cluster)</span>
                    </td>
                    <td>{num(r.calls)}</td>
                    <td>{usd(r.cost_usd)}</td>
                  </tr>
                ))}
              {loreByCluster.some((r) => r.cluster !== null) && (
                <tr>
                  <td colSpan={3} className={styles.subhead}>
                    Clusters
                  </td>
                </tr>
              )}
              {loreByCluster
                .filter((r) => r.cluster !== null)
                .map((r) => (
                  <tr key={r.cluster}>
                    <td>
                      <span className="badge">{r.cluster}</span>
                    </td>
                    <td>{num(r.calls)}</td>
                    <td>{usd(r.cost_usd)}</td>
                  </tr>
                ))}
              {loreByCluster.length === 0 && (
                <tr>
                  <td colSpan={3} className={`meta ${styles.center}`}>
                    No cluster-attributed spend
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* Below Month to Date, so the figures it depends on are read first: the
          balance is month-to-date spend subtracted from what was recorded, and
          it makes more sense after you have seen the spend than before.
          Anthropic exposes no credit-balance endpoint, so the recorded side of
          that subtraction is whatever a person has entered. */}
      <h2>Balance</h2>
      <div className={styles.cards}>
        {budget ? (
          <div className={`spec-card ${styles.balanceCard}`}>
            <div className="meta">Credits remaining</div>
            <div
              className={
                budget.remaining_usd < 0 ? styles.figureOver : styles.figureInfo
              }
            >
              {usd(budget.remaining_usd)}
            </div>
            {/* The clock shows only when the anchor carries one. An entry
                recorded for a day counts that whole day, and printing
                "00:00" would dress a deliberate approximation up as a
                measurement. */}
            <div className={`meta ${styles.subnote}`}>
              {usd(budget.ledger_total_usd)} recorded −{" "}
              {usd(budget.spent_since_usd)} spent since{" "}
              {day(anchorDay(budget.anchored_at))}
              {anchorTime(budget.anchored_at)
                ? `, ${anchorTime(budget.anchored_at)} UTC`
                : ""}
            </div>
            <BudgetOutlookNote budget={budget} />
          </div>
        ) : (
          <div className={`spec-card ${styles.balanceCard}`}>
            <div className="meta">Credits remaining</div>
            {/* Not "$0.00". Nobody having told us the balance is a different
                fact from the balance being nothing, and rendering the first as
                the second would read as "we are out of money". */}
            <div className={styles.figure}>—</div>
            <div className={`meta ${styles.subnote}`}>
              No balance recorded yet. Anthropic publishes usage and cost but
              not a credit balance, so the starting figure has to be entered
              once.
            </div>
          </div>
        )}
      </div>
      {loreByCluster?.some((r) => r.cluster !== null) && (
        <p className={`meta ${styles.subnote}`}>
          Cluster spend shown above is excluded from this balance: a satellite
          runs on its own credential and does not draw these credits.
        </p>
      )}
      {recordAction && (
        <RecordTopUp first={!budget} recordAction={recordAction} />
      )}

      <h2>Cost by Model (MTD)</h2>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Calls</th>
            <th>Cost</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
          </tr>
        </thead>
        <tbody>
          {loreByModel.map((r) => (
            <tr key={r.model || "(non-token)"}>
              <td>
                <span className="badge">{r.model || "(non-token)"}</span>
              </td>
              <td>{num(r.calls)}</td>
              <td>{usd(r.cost_usd)}</td>
              <td className={styles.mono}>{num(r.input_tokens)}</td>
              <td className={styles.mono}>{num(r.output_tokens)}</td>
            </tr>
          ))}
          {loreByModel.length === 0 && (
            <tr>
              <td colSpan={5} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Kind (MTD)</h2>
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Calls</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {loreByKind.map((r) => (
            <tr key={r.kind}>
              <td>{r.kind}</td>
              <td>{num(r.calls)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreByKind.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Daily Cost (This Month)</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Calls</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {loreDaily.map((r) => (
            <tr key={r.bucket_date}>
              <td>{day(r.bucket_date)}</td>
              <td>{num(r.calls)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreDaily.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Repo (MTD)</h2>
      <table>
        <thead>
          <tr>
            <th>Repo</th>
            <th>Tasks</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {loreByRepo.map((r) => (
            <tr key={r.target_repo}>
              <td className={styles.mono}>{r.target_repo}</td>
              <td>{num(r.tasks)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreByRepo.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No task-attributed spend (e.g. code-review lines carry no task)
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Task Type (MTD)</h2>
      <table>
        <thead>
          <tr>
            <th>Task Type</th>
            <th>Tasks</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {loreByTaskType.map((r) => (
            <tr key={r.task_type}>
              <td>
                <span className="badge">{r.task_type}</span>
              </td>
              <td>{num(r.tasks)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreByTaskType.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No task-attributed spend
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {orgAvailable && (
        <>
          <h2>Anthropic Billed by Model (MTD)</h2>
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Billed Cost</th>
                <th>Input Tokens</th>
                <th>Output Tokens</th>
              </tr>
            </thead>
            <tbody>
              {orgByModel.map((r) => (
                <tr key={r.model || "(non-token)"}>
                  <td>
                    <span className="badge">{r.model || "(non-token)"}</span>
                  </td>
                  <td>{usd(r.cost_usd)}</td>
                  <td className={styles.mono}>{num(r.input_tokens)}</td>
                  <td className={styles.mono}>{num(r.output_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Anthropic Daily Billed (This Month)</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Billed Cost</th>
              </tr>
            </thead>
            <tbody>
              {orgDaily.map((r) => (
                <tr key={r.bucket_date}>
                  <td>{day(r.bucket_date)}</td>
                  <td>{usd(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
