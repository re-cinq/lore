import type { ReactNode } from "react";
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

/** Twelve breakdowns of the same spend differ only in their columns, so they are one table that takes them. `empty` is the message for no rows; omit it where an absent breakdown means the vendor never synced rather than spent nothing. */
function CostTable<T>({
  title,
  columns,
  rows,
  rowKey,
  cells,
  monoColumns = [],
  empty = "No data",
}: {
  title: string;
  columns: string[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  cells: (row: T) => ReactNode[];
  monoColumns?: number[];
  empty?: string;
}) {
  return (
    <>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {cells(row).map((cell, index) => (
                <td
                  key={columns[index]}
                  className={
                    monoColumns.includes(index) ? styles.mono : undefined
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          <EmptyRow
            when={rows.length === 0}
            colSpan={columns.length}
            message={empty}
          />
        </tbody>
      </table>
    </>
  );
}

/** The row a table shows instead of nothing. Rendering it from the table body keeps every table's empty state one decision rather than nine. */
function EmptyRow({
  when,
  colSpan,
  message,
}: {
  when: boolean;
  colSpan: number;
  message: string;
}) {
  if (!when) {
    return null;
  }

  return (
    <tr>
      <td colSpan={colSpan} className={`meta ${styles.center}`}>
        {message}
      </td>
    </tr>
  );
}

export default function SpendView({ spend, recordAction }: SpendViewProps) {
  const { interval, llm, billed, budget, gcp, compute } = spend;

  return (
    <div>
      <SummaryCards
        interval={interval}
        llm={llm}
        billed={billed}
        gcp={gcp}
        compute={compute}
      />
      <BalanceSection
        budget={budget}
        hasClusterSpend={llm.by_cluster.some((r) => r.cluster !== null)}
        recordAction={recordAction}
      />
      <LlmBreakdowns llm={llm} />
      <BilledBreakdowns billed={billed} gcp={gcp} />
      <ComputeBreakdowns compute={compute} gcpAvailable={gcp.available} />
    </div>
  );
}

/** The headline figures: what Lore computed from token counts, what each vendor actually billed, and what the pods cost. A billed card appears only once that vendor has synced. */
/** One headline figure. `estimate` marks a number Lore computed rather than one a vendor billed, which is the distinction the whole page turns on. */
function StatCard({
  label,
  figure,
  estimate = false,
  children,
}: {
  label: ReactNode;
  figure: string;
  estimate?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`spec-card ${styles.card}`}>
      <div className="meta">{label}</div>
      <div className={estimate ? styles.figureInfo : styles.figure}>
        {figure}
      </div>
      {children}
    </div>
  );
}

function Subnote({ children }: { children: ReactNode }) {
  return <div className={`meta ${styles.subnote}`}>{children}</div>;
}

function SummaryCards({
  interval,
  llm,
  billed,
  gcp,
  compute,
}: {
  interval: SpendWindow["interval"];
  llm: SpendWindow["llm"];
  billed: SpendWindow["billed"];
  gcp: SpendWindow["gcp"];
  compute: SpendWindow["compute"];
}) {
  return (
    <div className={styles.cards}>
      <StatCard
        label={`Lore-computed cost ${day(interval.from)} → ${day(interval.to)}`}
        figure={usd(llm.total_usd)}
        estimate
      >
        <Subnote>estimate from token counts</Subnote>
      </StatCard>
      <StatCard label="API calls" figure={num(llm.calls)} />
      <StatCard label="Input tokens" figure={num(llm.input_tokens)} />
      <StatCard label="Output tokens" figure={num(llm.output_tokens)} />
      {billed.available && <AnthropicBilledCard billed={billed} />}
      <StatCard
        label="Kubernetes (estimated)"
        figure={usd(compute.est_total_usd)}
        estimate
      >
        <Subnote>+ {usd(compute.live_usd_per_hour)}/h burning now</Subnote>
      </StatCard>
      {/* GCP invoice synced from BigQuery export; lags a day+, so estimate still needed */}
      {gcp.available && <GcpBilledCard gcp={gcp} />}
    </div>
  );
}

/** The Anthropic invoice, plus what Lore metered after the last billed day — the report lags, so the unbilled remainder is surfaced separately and labelled rather than folded in. */
function AnthropicBilledCard({ billed }: { billed: SpendWindow["billed"] }) {
  return (
    <StatCard label="Billed cost (Anthropic)" figure={usd(billed.total_usd)}>
      <Subnote>as of {stamp(billed.as_of as string)}</Subnote>
      {billed.unbilled_usd > 0 && (
        <Subnote>
          {billed.billed_through
            ? `billed through ${day(billed.billed_through)}`
            : "not yet billed"}{" "}
          — + {usd(billed.unbilled_usd)}{" "}
          {billed.unbilled_days === 1
            ? "today"
            : `over ${num(billed.unbilled_days)} days since`}{" "}
          (Lore-computed)
        </Subnote>
      )}
    </StatCard>
  );
}

function GcpBilledCard({ gcp }: { gcp: SpendWindow["gcp"] }) {
  return (
    <StatCard label="Google Cloud (billed)" figure={usd(gcp.total_usd)}>
      <Subnote>
        {gcp.billed_through
          ? `billed through ${day(gcp.billed_through)}`
          : "no closed day in this interval yet"}{" "}
        — net of credits
      </Subnote>
    </StatCard>
  );
}

/** What is left of the recorded credits. Not interval-scoped: money persists, so this subtracts spend since the anchor from the amount on record. */
function BalanceSection({
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

/** Every cut of what Lore metered itself: by line, vendor, model, kind, day, repo, task type and cluster. */
function LlmBreakdowns({ llm }: { llm: SpendWindow["llm"] }) {
  return (
    <>
      <CostTable
        title="LLM by Assembly Line"
        columns={["Assembly line", "Runs", "Cost", "Cost / run"]}
        rows={llm.by_blueprint}
        rowKey={(r) => r.blueprint}
        cells={(r) => [
          r.blueprint,
          num(r.runs),
          usd(r.usd),
          // Cost per run: shows whether model/prompt changes paid off.
          r.runs > 0 ? usd(r.usd / r.runs) : "—",
        ]}
      />

      <CostTable
        title="Cost by Vendor"
        columns={["Vendor", "Calls", "Cost"]}
        rows={llm.by_vendor}
        rowKey={(r) => r.vendor}
        cells={(r) => [
          <span className="badge" key="vendor">
            {r.vendor}
          </span>,
          num(r.calls),
          usd(r.cost_usd),
        ]}
      />
      {/* Only Anthropic draws recorded credits; others bill their own vendor */}
      {llm.by_vendor.some((r) => r.vendor !== "anthropic") && (
        <p className={`meta ${styles.subnote}`}>
          Only Anthropic spend draws the balance above — other vendors bill
          their own account.
        </p>
      )}

      <CostTable
        title="Cost by Model"
        columns={["Model", "Calls", "Cost", "Input Tokens", "Output Tokens"]}
        rows={llm.by_model}
        rowKey={(r) => r.model || "(non-token)"}
        monoColumns={[3, 4]}
        cells={(r) => [
          <span className="badge" key="model">
            {r.model || "(non-token)"}
          </span>,
          num(r.calls),
          usd(r.cost_usd),
          num(r.input_tokens),
          num(r.output_tokens),
        ]}
      />

      <CostTable
        title="Cost by Kind"
        columns={["Kind", "Calls", "Cost"]}
        rows={llm.by_kind}
        rowKey={(r) => r.kind}
        cells={(r) => [r.kind, num(r.calls), usd(r.cost_usd)]}
      />

      <CostTable
        title="Daily Cost"
        columns={["Date", "Calls", "Cost"]}
        rows={llm.daily}
        rowKey={(r) => r.bucket_date}
        cells={(r) => [day(r.bucket_date), num(r.calls), usd(r.cost_usd)]}
      />

      <CostTable
        title="Cost by Repo"
        columns={["Repo", "Cost"]}
        rows={llm.by_repo}
        rowKey={(r) => r.repo}
        monoColumns={[0]}
        empty="No run-attributed spend"
        cells={(r) => [r.repo, usd(r.usd)]}
      />

      <CostTable
        title="Cost by Task Type"
        columns={["Task Type", "Tasks", "Cost"]}
        rows={llm.by_task_type}
        rowKey={(r) => r.task_type}
        empty="No task-attributed spend"
        cells={(r) => [
          <span className="badge" key="task-type">
            {r.task_type}
          </span>,
          num(r.tasks),
          usd(r.cost_usd),
        ]}
      />

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
          <EmptyRow
            when={llm.by_cluster.length === 0}
            colSpan={3}
            message="No cluster-attributed spend"
          />
        </tbody>
      </table>
    </>
  );
}

/** What the two vendors actually billed. Each half renders only once that vendor has synced — an absent section means "never synced", not "spent nothing". */
function BilledBreakdowns({
  billed,
  gcp,
}: {
  billed: SpendWindow["billed"];
  gcp: SpendWindow["gcp"];
}) {
  return (
    <>
      {billed.available && (
        <>
          <CostTable
            title="Anthropic Billed by Model"
            columns={["Model", "Billed Cost", "Input Tokens", "Output Tokens"]}
            rows={billed.by_model}
            rowKey={(r) => r.model || "(non-token)"}
            monoColumns={[2, 3]}
            cells={(r) => [
              <span className="badge" key="model">
                {r.model || "(non-token)"}
              </span>,
              usd(r.cost_usd),
              num(r.input_tokens),
              num(r.output_tokens),
            ]}
          />

          <CostTable
            title="Anthropic Daily Billed"
            columns={["Date", "Billed Cost"]}
            rows={billed.daily}
            rowKey={(r) => r.bucket_date}
            cells={(r) => [day(r.bucket_date), usd(r.cost_usd)]}
          />
        </>
      )}

      {gcp.available && (
        <>
          <CostTable
            title="GCP Billed by Service"
            columns={["Service", "Billed Cost"]}
            rows={gcp.by_service}
            rowKey={(r) => r.service}
            cells={(r) => [r.service, usd(r.cost_usd)]}
          />

          <CostTable
            title="GCP Daily Billed"
            columns={["Date", "Billed Cost"]}
            rows={gcp.daily}
            rowKey={(r) => r.bucket_date}
            cells={(r) => [day(r.bucket_date), usd(r.cost_usd)]}
          />
        </>
      )}
    </>
  );
}

/** Pods burning money right now, and the hours already spent in the interval. */
function ComputeBreakdowns({
  compute,
  gcpAvailable,
}: {
  compute: SpendWindow["compute"];
  gcpAvailable: boolean;
}) {
  return (
    <>
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

      <CostTable
        title="Pod-Hours in Interval"
        columns={["Assembly line", "Pods", "Hours", "Est. cost"]}
        rows={compute.pod_hours}
        rowKey={(r) => r.blueprint}
        cells={(r) => [r.blueprint, num(r.pods), num(r.hours), usd(r.est_usd)]}
      />
      <p className={`meta ${styles.subnote}`}>
        Compute is an estimate from resource requests × on-demand rates ($
        {compute.rates.cpu_hour_usd}/cpu-h, ${compute.rates.mem_gib_hour_usd}
        /GiB-h); interval pod-hours assume a {compute.assumed_profile.cpu} cpu /{" "}
        {compute.assumed_profile.memory} pod. Google&apos;s invoice lags a day
        and is the truth
        {gcpAvailable
          ? " — the Google Cloud (billed) figures above are that invoice."
          : "."}
      </p>
    </>
  );
}
