import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num, day } from "./spend-format";
import { CostTable, EmptyRow } from "./CostTable";

interface LlmProps {
  llm: SpendWindow["llm"];
}

interface ByClusterProps {
  byCluster: SpendWindow["llm"]["by_cluster"];
}

interface ClusterRowsProps {
  label: string;
  rows: SpendWindow["llm"]["by_cluster"];
}

/** The null bucket is spend on the home account; every other row is a registered cluster running on its own credential. */
function ClusterRow({ row }: { row: ClusterRowsProps["rows"][number] }) {
  return (
    <tr>
      <td>
        <span className="badge">{row.cluster ?? "(no cluster)"}</span>
      </td>
      <td>{num(row.calls)}</td>
      <td>{usd(row.cost_usd)}</td>
    </tr>
  );
}

/** A labelled group of clusters. The null bucket is home-account spend and the rest are registered clusters; both render the same way, so the only difference is the filter the caller applies and the subhead. Renders nothing when the group is empty, so an absent bucket leaves no orphan heading. */
function ClusterRows({ label, rows }: ClusterRowsProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <>
      <tr>
        <td colSpan={3} className={styles.subhead}>
          {label}
        </td>
      </tr>
      {rows.map((r) => (
        <ClusterRow key={r.cluster ?? "no-cluster"} row={r} />
      ))}
    </>
  );
}

/** Unattributed spend first, then the clusters. The split is deliberate: spend with no cluster is not a cluster called "none", and grouping it in would make one cluster look far more expensive than it is. */
function ClusterBody({ byCluster }: ByClusterProps) {
  return (
    <tbody>
      <ClusterRows
        label="No cluster"
        rows={byCluster.filter((r) => r.cluster === null)}
      />
      <ClusterRows
        label="Clusters"
        rows={byCluster.filter((r) => r.cluster !== null)}
      />
      <EmptyRow
        when={byCluster.length === 0}
        colSpan={3}
        message="No cluster-attributed spend"
      />
    </tbody>
  );
}

function ClusterBreakdown({ byCluster }: ByClusterProps) {
  return (
    <>
      <h2>Cost by Cluster</h2>
      <table>
        <thead>
          <tr>
            <th>Cluster</th>
            <th>Calls</th>
            <th>Cost</th>
          </tr>
        </thead>
        <ClusterBody byCluster={byCluster} />
      </table>
    </>
  );
}

/** "No run-attributed spend" is a different statement from "no spend", so this table carries its own empty text. */
function RepoCosts({ llm }: LlmProps) {
  return (
    <CostTable
      title="Cost by Repo"
      columns={["Repo", "Cost"]}
      rows={llm.by_repo}
      rowKey={(r) => r.repo}
      monoColumns={[0]}
      empty="No run-attributed spend"
      cells={(r) => [r.repo, usd(r.usd)]}
    />
  );
}

function TaskTypeCosts({ llm }: LlmProps) {
  return (
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
  );
}

/** The two cuts that depend on a call being traced back to work: the repo it was for, and the kind of task it served. */
function AttributedBreakdowns({ llm }: LlmProps) {
  return (
    <>
      <RepoCosts llm={llm} />

      <TaskTypeCosts llm={llm} />
    </>
  );
}

function KindCosts({ llm }: LlmProps) {
  return (
    <CostTable
      title="Cost by Kind"
      columns={["Kind", "Calls", "Cost"]}
      rows={llm.by_kind}
      rowKey={(r) => r.kind}
      cells={(r) => [r.kind, num(r.calls), usd(r.cost_usd)]}
    />
  );
}

function DailyCosts({ llm }: LlmProps) {
  return (
    <CostTable
      title="Daily Cost"
      columns={["Date", "Calls", "Cost"]}
      rows={llm.daily}
      rowKey={(r) => r.bucket_date}
      cells={(r) => [day(r.bucket_date), num(r.calls), usd(r.cost_usd)]}
    />
  );
}

/** The cuts that answer "where did it go": by kind of work, by day, by repo, by task type, and by cluster. */
function LlmBreakdownsBySlice({ llm }: LlmProps) {
  return (
    <>
      <KindCosts llm={llm} />

      <DailyCosts llm={llm} />

      <AttributedBreakdowns llm={llm} />
      <ClusterBreakdown byCluster={llm.by_cluster} />
    </>
  );
}

interface ByVendorProps {
  byVendor: SpendWindow["llm"]["by_vendor"];
}

function VendorCostTable({ byVendor }: ByVendorProps) {
  return (
    <CostTable
      title="Cost by Vendor"
      columns={["Vendor", "Calls", "Cost"]}
      rows={byVendor}
      rowKey={(r) => r.vendor}
      cells={(r) => [
        <span className="badge" key="vendor">
          {r.vendor}
        </span>,
        num(r.calls),
        usd(r.cost_usd),
      ]}
    />
  );
}

/** The note belongs WITH this table: a deployment using another vendor would otherwise read every row here as money Anthropic charged. */
function VendorCosts({ byVendor }: ByVendorProps) {
  return (
    <>
      <VendorCostTable byVendor={byVendor} />
      {byVendor.some((r) => r.vendor !== "anthropic") && (
        <p className={`meta ${styles.subnote}`}>
          Vendors other than Anthropic bill their own account, so their spend is
          not charged to Anthropic&apos;s invoice.
        </p>
      )}
    </>
  );
}

/** What Lore metered per model. This is the computed figure, not the invoice — the billed table alongside it is the vendor's own number, and the two are shown separately rather than reconciled here. */
function ModelCosts({ byModel }: { byModel: SpendWindow["llm"]["by_model"] }) {
  return (
    <CostTable
      title="Cost by Model"
      columns={["Model", "Calls", "Cost", "Input Tokens", "Output Tokens"]}
      rows={byModel}
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
  );
}

function AssemblyLineCosts({ llm }: LlmProps) {
  return (
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
  );
}

/** Every cut of what Lore metered itself: by line, vendor, model, kind, day, repo, task type and cluster. */
export function LlmBreakdowns({ llm }: LlmProps) {
  return (
    <>
      <AssemblyLineCosts llm={llm} />

      <VendorCosts byVendor={llm.by_vendor} />

      <ModelCosts byModel={llm.by_model} />

      <LlmBreakdownsBySlice llm={llm} />
    </>
  );
}
