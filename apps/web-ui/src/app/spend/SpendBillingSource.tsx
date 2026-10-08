import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num } from "./spend-format";
import { CostTable } from "./CostTable";

type BillingMode = "api" | "subscription" | "unknown";

type BaseClusterRow = SpendWindow["llm"]["by_cluster"][number];
type ClusterRow = BaseClusterRow & { billing_mode?: BillingMode };
type ByCluster = ClusterRow[];

interface Bucket {
  calls: number;
  cost_usd: number;
}

export interface BillingSourceSplit {
  api: Bucket;
  subscription: Bucket;
}

export function billingSourceSplit(byCluster: ByCluster): BillingSourceSplit {
  return {
    api: sum(byCluster.filter((r) => resolveMode(r) === "api")),
    subscription: sum(
      byCluster.filter((r) => resolveMode(r) === "subscription"),
    ),
  };
}

function resolveMode(r: ClusterRow): "api" | "subscription" {
  if (r.billing_mode === "api") {
    return "api";
  }

  if (r.billing_mode === "subscription") {
    return "subscription";
  }

  return r.cluster === null ? "api" : "subscription";
}

function sum(rows: ByCluster): Bucket {
  return rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      cost_usd: acc.cost_usd + r.cost_usd,
    }),
    { calls: 0, cost_usd: 0 },
  );
}

interface SourceRow {
  source: string;
  calls: number;
  cost_usd: number;
}

/** The API-vs-subscription split of metered spend, so a reader can tell how much of the figure the Anthropic invoice can even see. Only renders when spend is cluster-attributed — with nothing attributed the split has no basis. */
export function BillingSource({ byCluster }: { byCluster: ByCluster }) {
  if (byCluster.length === 0) {
    return null;
  }

  const hasRecordedMode = byCluster.some(
    (r) => r.billing_mode === "api" || r.billing_mode === "subscription",
  );

  return (
    <>
      <CostTable
        title="Billing Source"
        columns={["Source", "Calls", "Cost"]}
        rows={sourceRows(billingSourceSplit(byCluster))}
        rowKey={(r) => r.source}
        cells={(r) => [r.source, num(r.calls), usd(r.cost_usd)]}
      />
      <BillingSourceNote recorded={hasRecordedMode} />
    </>
  );
}

function sourceRows({ api, subscription }: BillingSourceSplit): SourceRow[] {
  return [
    { source: "API key (org account)", ...api },
    { source: "Subscription (satellite credential)", ...subscription },
  ];
}

function BillingSourceNote({ recorded }: { recorded: boolean }) {
  if (recorded) {
    return (
      <p className={`meta ${styles.subnote}`}>
        Billing mode recorded at dispatch time: API key calls use the org
        account, subscription calls bill each person&apos;s own account and
        never reach the org invoice. Rows without a recorded mode fall back to
        cluster attribution.
      </p>
    );
  }

  return (
    <p className={`meta ${styles.subnote}`}>
      Derived from which cluster ran each call: no cluster is the org&apos;s own
      API key, a named cluster is a satellite on its own subscription. The
      billed figure covers only the API-key portion — subscription runs bill
      each person&apos;s own account, so they never reach the org invoice.
    </p>
  );
}
