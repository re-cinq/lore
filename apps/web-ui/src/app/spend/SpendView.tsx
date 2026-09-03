import styles from "./SpendView.module.css";
import type { components } from "@/lib/api/schema";
import RecordTopUp from "./RecordTopUp";
import type { RecordTopUpState } from "./actions";

// Rows are aliases over OpenAPI /api/analytics/spend-window contract (ADR-035); balance is not scoped to interval
export type SpendWindow = components["schemas"]["SpendWindow"];

export type BudgetRow = SpendWindow["budget"];

export interface SpendViewProps {
  spend: SpendWindow;
  /** Records money added; omitted → form not rendered, figures read-only. */
  recordAction?: (
    prev: RecordTopUpState | null,
    formData: FormData,
  ) => Promise<RecordTopUpState>;
}

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

/** Render YYYY-MM-DD as DD-MM-YYYY: parse string not Date to avoid UTC shift, fixed locale for consistency. */
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

/** Anchor day: parse as string, not Date, to avoid UTC→local timezone shift. */
const anchorDay = (anchoredAt: string) => anchoredAt.slice(0, 10);

/** Clock part, or null if entry anchors to start of day (no known time). */
const anchorTime = (anchoredAt: string) => {
  const clock = anchoredAt.slice(11, 16);

  return !clock || clock === "00:00" ? null : clock;
};

/** Daily burn rate and projected runway from anchor; null if anchor is future or no spend yet. */
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
            {/* Anthropic report lags; surface unbilled amount separately and labeled */}
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
        {/* GCP invoice synced from BigQuery export; lags a day+, so estimate still needed */}
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

      {/* Balance: not scoped to interval (money persists); subtract spend from recorded amount */}
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
            {/* Clock only if anchor carries it; day-recorded entries don't show 00:00 */}
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
            {/* No $0.00: unrecorded balance ≠ exhausted; use em dash */}
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
            {/* Cost per run: shows whether model/prompt changes paid off */}
            <th>Cost / run</th>
          </tr>
        </thead>
        <tbody>
          {llm.by_blueprint.map((r) => (
            <tr key={r.blueprint}>
              <td>{r.blueprint}</td>
              <td>{num(r.runs)}</td>
              <td>{usd(r.usd)}</td>
              <td>{r.runs > 0 ? usd(r.usd / r.runs) : "—"}</td>
            </tr>
          ))}
          {llm.by_blueprint.length === 0 && (
            <tr>
              <td colSpan={4} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Cost by Vendor</h2>
      <table>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Calls</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {llm.by_vendor.map((r) => (
            <tr key={r.vendor}>
              <td>
                <span className="badge">{r.vendor}</span>
              </td>
              <td>{num(r.calls)}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {llm.by_vendor.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {/* Only Anthropic draws recorded credits; others bill their own vendor */}
      {llm.by_vendor.some((r) => r.vendor !== "anthropic") && (
        <p className={`meta ${styles.subnote}`}>
          Only Anthropic spend draws the balance above — other vendors bill
          their own account.
        </p>
      )}

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
          {/* Null bucket: home account spend; rest: registered clusters */}
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
