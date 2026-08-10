import styles from "./SpendView.module.css";

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
   * Where the org figures came from. `live` means the Floor answered with a
   * fresh Admin API read; `cache` means the nightly `anthropic_cost_sync`
   * rollup. Optional so callers that have no source (tests, older callers)
   * render exactly as before.
   */
  orgSource?: "live" | "cache";
  orgByModel: OrgByModelRow[];
  orgDaily: OrgDailyRow[];
  loreComputedUsd: number;
  loreByRepo: LoreByRepoRow[];
  loreByTaskType: LoreByTaskTypeRow[];
}

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

/**
 * `live-empty` is the state a live read that found no billed spend this month
 * lands in: the figures are genuinely zero and genuinely known, so they must
 * not render as "—" or blame a missing key the read just proved is present.
 */
type OrgState = "available" | "live-empty" | "unavailable";

function resolveOrgState(
  orgAvailable: boolean,
  orgSource?: "live" | "cache",
): OrgState {
  if (orgAvailable) {
    return "available";
  }

  if (orgSource === "live") {
    return "live-empty";
  }

  return "unavailable";
}

function orgSubnote(state: OrgState, asOf: string | null): string {
  if (state === "available") {
    return `as of ${new Date(asOf as string).toLocaleString()}`;
  }

  if (state === "live-empty") {
    return "no billed spend this month yet";
  }

  return "admin key not configured";
}

const sourceLabel = (source: "live" | "cache") =>
  source === "live" ? "live from Anthropic" : "from the last nightly sync";

export default function SpendView({
  orgMtd,
  orgAvailable,
  orgSource,
  orgByModel,
  orgDaily,
  loreComputedUsd,
  loreByRepo,
  loreByTaskType,
}: SpendViewProps) {
  const orgState = resolveOrgState(orgAvailable, orgSource);
  const orgKnown = orgState !== "unavailable";

  return (
    <div>
      <h1>Claude API Spend</h1>

      {/* Month-to-date totals */}
      <h2>Month to Date</h2>
      <div className={styles.cards}>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Billed cost (Anthropic)</div>
          <div className={styles.figure}>
            {orgKnown ? usd(orgMtd.billed_usd) : "—"}
          </div>
          <div className={`meta ${styles.subnote}`}>
            {orgSubnote(orgState, orgMtd.as_of)}
          </div>
          {/* Rendered as a sibling rather than appended to the line above so
              the "as of …" text stays an exact leaf node. */}
          {orgKnown && orgSource ? (
            <div className={`meta ${styles.subnote}`}>
              {sourceLabel(orgSource)}
            </div>
          ) : null}
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Lore-computed cost</div>
          <div className={styles.figureInfo}>{usd(loreComputedUsd)}</div>
          <div className={`meta ${styles.subnote}`}>
            estimate from token counts
          </div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Input Tokens</div>
          <div className={styles.figure}>
            {orgKnown ? Number(orgMtd.input_tokens).toLocaleString() : "—"}
          </div>
        </div>
        <div className={`spec-card ${styles.card}`}>
          <div className="meta">Output Tokens</div>
          <div className={styles.figure}>
            {orgKnown ? Number(orgMtd.output_tokens).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      {/* Suppressed when the source is `live`: a successful live read proves
          the key is configured, so an empty month means the org simply has no
          billed spend yet — not a misconfiguration. */}
      {orgState === "unavailable" && (
        <div className={`spec-card ${styles.warningCard}`}>
          <strong>Org-wide billed cost unavailable.</strong>
          <div className={`meta ${styles.warningNote}`}>
            Either the Floor is unreachable, or <code>ANTHROPIC_ADMIN_KEY</code>{" "}
            (an <code>sk-ant-admin…</code> key) is unset there, so neither the
            live read nor the daily <code>anthropic-cost-sync</code> cron can
            pull Anthropic&apos;s authoritative Cost report. Showing
            Lore-computed estimates only.
          </div>
        </div>
      )}

      {/* Authoritative breakdowns */}
      <h2>Billed Cost by Model (MTD)</h2>
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
              <td className={styles.mono}>
                {Number(r.input_tokens).toLocaleString()}
              </td>
              <td className={styles.mono}>
                {Number(r.output_tokens).toLocaleString()}
              </td>
            </tr>
          ))}
          {orgByModel.length === 0 && (
            <tr>
              <td colSpan={4} className={`meta ${styles.center}`}>
                No billed data yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Daily Billed Cost (This Month)</h2>
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
          {orgDaily.length === 0 && (
            <tr>
              <td colSpan={2} className={`meta ${styles.center}`}>
                No billed data yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Lore-attributed breakdowns */}
      <h2>Lore-Computed Cost by Repo (MTD)</h2>
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
              <td>{Number(r.tasks).toLocaleString()}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreByRepo.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Lore-Computed Cost by Task Type (MTD)</h2>
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
              <td>{Number(r.tasks).toLocaleString()}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreByTaskType.length === 0 && (
            <tr>
              <td colSpan={3} className={`meta ${styles.center}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
