import styles from "./SpendView.module.css";

// Anthropic's authoritative billed cost (Admin Cost API → anthropic_cost_daily).
// Optional — only present when an sk-ant-admin… key is configured.
export interface OrgMtdRow {
  billed_usd: number;
  input_tokens: number;
  output_tokens: number;
  as_of: string | null;
}

export interface OrgByModelRow {
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface OrgDailyRow {
  bucket_date: string;
  cost_usd: number;
}

// Lore-computed cost (pipeline.llm_calls) — the always-available source, no
// admin key required. Attributes spend by model, kind, day, repo, task type.
export interface LoreMtdRow {
  computed_usd: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

export interface LoreByModelRow {
  model: string;
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface LoreByKindRow {
  kind: string;
  calls: number;
  cost_usd: number;
}

export interface LoreDailyRow {
  bucket_date: string;
  calls: number;
  cost_usd: number;
}

export interface LoreByRepoRow {
  target_repo: string;
  tasks: number;
  cost_usd: number;
}

export interface LoreByTaskTypeRow {
  task_type: string;
  tasks: number;
  cost_usd: number;
}

export interface SpendViewProps {
  orgMtd: OrgMtdRow;
  orgAvailable: boolean;
  /**
   * Today's Lore-computed spend (pipeline.llm_calls). Anthropic's cost report
   * is daily-granularity and never emits the in-progress day, so the billed
   * MTD figure always ends at yesterday — this is the only number that can
   * bring it current, and llm_calls has been verified token-exact against
   * Anthropic's hourly usage report. Optional so callers without it render
   * exactly as before.
   */
  loreTodayUsd?: number;
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

export default function SpendView({
  orgMtd,
  orgAvailable,
  loreTodayUsd,
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
                the billed figure ends at yesterday. Surface today separately
                and labeled rather than folding it in: the sum would silently
                mix an authoritative number with a computed one. */}
            {loreTodayUsd !== undefined && loreTodayUsd > 0 && (
              <div className={`meta ${styles.subnote}`}>
                billed through yesterday — + {usd(loreTodayUsd)} today
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
