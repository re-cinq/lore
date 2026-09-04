import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num, day } from "./spend-format";
import { CostTable, EmptyRow } from "./CostTable";

/** The null bucket is spend on the home account; every other row is a registered cluster running on its own credential. */
function ClusterBreakdown({
  byCluster,
}: {
  byCluster: SpendWindow["llm"]["by_cluster"];
}) {
  const llm = { by_cluster: byCluster };

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

/** The cuts that answer "where did it go": by kind of work, by day, by repo, by task type, and by cluster. */
function LlmBreakdownsBySlice({ llm }: { llm: SpendWindow["llm"] }) {
  return (
    <>
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

      <ClusterBreakdown byCluster={llm.by_cluster} />
    </>
  );
}

/** Every cut of what Lore metered itself: by line, vendor, model, kind, day, repo, task type and cluster. */
export function LlmBreakdowns({ llm }: { llm: SpendWindow["llm"] }) {
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

      <LlmBreakdownsBySlice llm={llm} />
    </>
  );
}
