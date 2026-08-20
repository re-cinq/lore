import styles from "./SpendView.module.css";
import type { components } from "@/lib/api/schema";

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

export interface SpendViewProps {
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
}

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

/**
 * A `YYYY-MM-DD` calendar day rendered in the viewer's locale. Built from the
 * parts rather than parsed: `new Date("2026-08-18")` is UTC midnight, which
 * renders as the 17th for every viewer west of Greenwich.
 */
const day = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-").map(Number);

  return new Date(y, m - 1, d).toLocaleDateString();
};

export default function SpendView({
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
              as of {new Date(orgMtd.as_of as string).toLocaleString()}
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
              <td>{new Date(r.bucket_date).toLocaleDateString()}</td>
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
                  <td>{new Date(r.bucket_date).toLocaleDateString()}</td>
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
