import styles from "./SpendView.module.css";
import type { components } from "@/lib/api/schema";
import RecordTopUp from "./RecordTopUp";
import type { RecordTopUpState } from "./actions";

// Every row here is an alias over the OpenAPI document lore-api generates from
// the /api/analytics/spend-window contract (ADR-035). None of these shapes
// comes from a table — they are SQL aggregates — so the contract is stated
// beside the queries that produce them, and this file reads it rather than
// restating it. The whole page is scoped to ONE selected interval; the
// balance is the deliberate exception (a balance added in June is still money
// in August), and the live pod list is by nature "now".

export type SpendWindow = components["schemas"]["SpendWindow"];

export type BudgetRow = SpendWindow["budget"];

export interface SpendViewProps {
  spend: SpendWindow;
  /** Records money added. Omitted → the form is not rendered; the figures are
   *  read-only either way. */
  recordAction?: (
    prev: RecordTopUpState | null,
    formData: FormData,
  ) => Promise<RecordTopUpState>;
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
  const [year, month, dayOfMonth] = isoDay.split("-");

  return `${dayOfMonth}-${month}-${year}`;
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
  const [year, month, dayOfMonth] = isoDay.split("-").map(Number);

  return new Date(year, month - 1, dayOfMonth);
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

export default function SpendView({ spend, recordAction }: SpendViewProps) {
  const { interval, llm, billed, budget, gcp, compute } = spend;

  return (
    <div>
      <div className={styles.cards}>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">
            Lore-computed cost {day(interval.from)} → {day(interval.to)}
          </div>
          <div className={styles.figureInfo}>{usd(llm.total_usd)}</div>
          <div className={`meta ${styles.subnote}`}>
            estimate from token counts
          </div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">API calls</div>
          <div className={styles.figure}>{num(llm.calls)}</div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Input tokens</div>
          <div className={styles.figure}>{num(llm.input_tokens)}</div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Output tokens</div>
          <div className={styles.figure}>{num(llm.output_tokens)}</div>
        </div>
        {billed.available && (
          <div className={`spec-card ${styles.card}`}>
            <div className="meta">Billed cost (Anthropic)</div>
            <div className={styles.figure}>{usd(billed.total_usd)}</div>
            <div className={`meta ${styles.subnote}`}>
              as of {stamp(billed.as_of as string)}
            </div>
            {/* Anthropic's cost report never includes the in-progress day, so
                the billed figure always trails. Surface the remainder
                separately and labeled rather than folding it in: the sum would
                silently mix an authoritative number with a computed one. The
                span is read from `billed_through`, never assumed to be one day
                — assuming it is what made this line understate the gap by a
                whole day's spend whenever the sync fell behind. */}
            {billed.unbilled_usd > 0 && (
              <div className={`meta ${styles.subnote}`}>
                {billed.billed_through
                  ? `billed through ${day(billed.billed_through)}`
                  : "not yet billed"}{" "}
                — + {usd(billed.unbilled_usd)}{" "}
                {billed.unbilled_days === 1
                  ? "today"
                  : `over ${num(billed.unbilled_days)} days since`}{" "}
                (Lore-computed)
              </div>
            )}
          </div>
        )}
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Kubernetes (estimated)</div>
          <div className={styles.figureInfo}>{usd(compute.est_total_usd)}</div>
          <div className={`meta ${styles.subnote}`}>
            + {usd(compute.live_usd_per_hour)}/h burning now
          </div>
        </div>
        {/* Google's actual invoice for the interval, net of credits, synced
            daily from the Cloud Billing BigQuery export. Beside the estimate
            rather than replacing it: the export lags a day or more, so the
            estimate stays the only figure that covers "now". Absent (like the
            Anthropic billed card) until the sync has ever run. */}
        {gcp.available && (
          <div className={`spec-card ${styles.card}`}>
            <div className="meta">Google Cloud (billed)</div>
            <div className={styles.figure}>{usd(gcp.total_usd)}</div>
            <div className={`meta ${styles.subnote}`}>
              {gcp.billed_through
                ? `billed through ${day(gcp.billed_through)}`
                : "no closed day in this interval yet"}{" "}
              — net of credits
            </div>
          </div>
        )}
      </div>

      {/* Below the interval figures, so the numbers it depends on are read
          first: the balance is spend subtracted from what was recorded, and it
          makes more sense after you have seen the spend than before. Anthropic
          exposes no credit-balance endpoint, so the recorded side of that
          subtraction is whatever a person has entered. The one section NOT
          scoped to the interval — a balance added in June is still money in
          August, and clipping it to the window would silently forgive every
          dollar spent outside it. */}
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
      {llm.by_cluster.some((r) => r.cluster !== null) && (
        <p className={`meta ${styles.subnote}`}>
          Cluster spend shown below is excluded from this balance: a satellite
          runs on its own credential and does not draw these credits.
        </p>
      )}
      {recordAction && (
        <RecordTopUp first={!budget} recordAction={recordAction} />
      )}

      <h2>LLM by Assembly Line</h2>
      <table>
        <thead>
          <tr>
            <th>Assembly line</th>
            <th>Runs</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {llm.by_blueprint.map((r) => (
            <tr key={r.blueprint}>
              <td>{r.blueprint}</td>
              <td>{num(r.runs)}</td>
              <td>{usd(r.usd)}</td>
            </tr>
          ))}
          {llm.by_blueprint.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Model</h2>
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
          {llm.by_model.map((r) => (
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
          {llm.by_model.length === 0 && (
            <tr>
              <td colSpan={5} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Kind</h2>
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Calls</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {llm.by_kind.map((r) => (
            <tr key={r.kind}>
              <td>{r.kind}</td>
              <td>{num(r.calls)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {llm.by_kind.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Daily Cost</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Calls</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {llm.daily.map((r) => (
            <tr key={r.bucket_date}>
              <td>{day(r.bucket_date)}</td>
              <td>{num(r.calls)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {llm.daily.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Repo</h2>
      <table>
        <thead>
          <tr>
            <th>Repo</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {llm.by_repo.map((r) => (
            <tr key={r.repo}>
              <td className={styles.mono}>{r.repo}</td>
              <td>{usd(r.usd)}</td>
            </tr>
          ))}
          {llm.by_repo.length === 0 && (
            <tr>
              <td colSpan={2} className={`meta ${styles.center}`}>
                No run-attributed spend
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Task Type</h2>
      <table>
        <thead>
          <tr>
            <th>Task Type</th>
            <th>Tasks</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {llm.by_task_type.map((r) => (
            <tr key={r.task_type}>
              <td>
                <span className="badge">{r.task_type}</span>
              </td>
              <td>{num(r.tasks)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {llm.by_task_type.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No task-attributed spend
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Cluster</h2>
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
              spend does not touch the balance above. */}
          {llm.by_cluster.some((r) => r.cluster === null) && (
            <tr>
              <td colSpan={3} className={styles.subhead}>
                No cluster
              </td>
            </tr>
          )}
          {llm.by_cluster
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
          {llm.by_cluster.some((r) => r.cluster !== null) && (
            <tr>
              <td colSpan={3} className={styles.subhead}>
                Clusters
              </td>
            </tr>
          )}
          {llm.by_cluster
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
          {llm.by_cluster.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No cluster-attributed spend
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {billed.available && (
        <>
          <h2>Anthropic Billed by Model</h2>
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
              {billed.by_model.map((r) => (
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

          <h2>Anthropic Daily Billed</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Billed Cost</th>
              </tr>
            </thead>
            <tbody>
              {billed.daily.map((r) => (
                <tr key={r.bucket_date}>
                  <td>{day(r.bucket_date)}</td>
                  <td>{usd(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {gcp.available && (
        <>
          <h2>GCP Billed by Service</h2>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Billed Cost</th>
              </tr>
            </thead>
            <tbody>
              {gcp.by_service.map((r) => (
                <tr key={r.service}>
                  <td>{r.service}</td>
                  <td>{usd(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>GCP Daily Billed</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Billed Cost</th>
              </tr>
            </thead>
            <tbody>
              {gcp.daily.map((r) => (
                <tr key={r.bucket_date}>
                  <td>{day(r.bucket_date)}</td>
                  <td>{usd(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Pods Running Now</h2>
      {compute.live_pods.length === 0 ? (
        <p className="meta">No run pods are live right now.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pod</th>
              <th>Requests</th>
              <th>$/hour</th>
              <th>So far</th>
            </tr>
          </thead>
          <tbody>
            {compute.live_pods.map((pod) => (
              <tr key={pod.name}>
                <td>{pod.name}</td>
                <td>
                  {pod.requests.cpu ?? "—"} cpu · {pod.requests.memory ?? "—"}
                </td>
                <td>{usd(pod.usd_per_hour)}</td>
                <td>{usd(pod.usd_so_far)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Pod-Hours in Interval</h2>
      <table>
        <thead>
          <tr>
            <th>Assembly line</th>
            <th>Pods</th>
            <th>Hours</th>
            <th>Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {compute.pod_hours.map((r) => (
            <tr key={r.blueprint}>
              <td>{r.blueprint}</td>
              <td>{num(r.pods)}</td>
              <td>{num(r.hours)}</td>
              <td>{usd(r.est_usd)}</td>
            </tr>
          ))}
          {compute.pod_hours.length === 0 && (
            <tr>
              <td colSpan={4} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={`meta ${styles.subnote}`}>
        Compute is an estimate from resource requests × on-demand rates ($
        {compute.rates.cpu_hour_usd}/cpu-h, ${compute.rates.mem_gib_hour_usd}
        /GiB-h); interval pod-hours assume a {compute.assumed_profile.cpu} cpu /{" "}
        {compute.assumed_profile.memory} pod. Google&apos;s invoice lags a day
        and is the truth
        {gcp.available
          ? " — the Google Cloud (billed) figures above are that invoice."
          : "."}
      </p>
    </div>
  );
}
