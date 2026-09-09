import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num, day } from "./spend-format";
import { CostTable } from "./CostTable";

interface BilledByModelProps {
  byModel: SpendWindow["billed"]["by_model"];
}

interface DailyBilledProps {
  title: string;
  rows: SpendWindow["billed"]["daily"];
}

/** A vendor's invoice by day. Anthropic's rows and GCP's have the same shape, so the two tables are one component with a different title. */
function DailyBilledTable({ title, rows }: DailyBilledProps) {
  return (
    <CostTable
      title={title}
      columns={["Date", "Billed Cost"]}
      rows={rows}
      rowKey={(r) => r.bucket_date}
      cells={(r) => [day(r.bucket_date), usd(r.cost_usd)]}
    />
  );
}

/** The invoice split by model. A row with no model name is billing that is not per-token — it is labelled rather than hidden, because it still lands on the same invoice. */
function BilledByModel({ byModel }: BilledByModelProps) {
  return (
    <CostTable
      title="Anthropic Billed by Model"
      columns={["Model", "Billed Cost", "Input Tokens", "Output Tokens"]}
      rows={byModel}
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
  );
}

/** Anthropic's own invoice, shown only where the billing export is wired up — an unavailable export is a deployment fact, not an empty month. */
function AnthropicBilled({ billed }: { billed: SpendWindow["billed"] }) {
  if (!billed.available) {
    return null;
  }

  return (
    <>
      <BilledByModel byModel={billed.by_model} />

      <DailyBilledTable title="Anthropic Daily Billed" rows={billed.daily} />
    </>
  );
}

/** The same for GCP: what the cloud invoice says, when that export exists. */
function GcpBilled({ gcp }: { gcp: SpendWindow["gcp"] }) {
  if (!gcp.available) {
    return null;
  }

  return (
    <>
      <CostTable
        title="GCP Billed by Service"
        columns={["Service", "Billed Cost"]}
        rows={gcp.by_service}
        rowKey={(r) => r.service}
        cells={(r) => [r.service, usd(r.cost_usd)]}
      />

      <DailyBilledTable title="GCP Daily Billed" rows={gcp.daily} />
    </>
  );
}

/** What the two vendors actually billed. Each half renders only once that vendor has synced — an absent section means "never synced", not "spent nothing". */
export function BilledBreakdowns({
  billed,
  gcp,
}: {
  billed: SpendWindow["billed"];
  gcp: SpendWindow["gcp"];
}) {
  return (
    <>
      <AnthropicBilled billed={billed} />
      <GcpBilled gcp={gcp} />
    </>
  );
}

/** One running pod and what it has cost so far. */
function LivePodRow({
  pod,
}: {
  pod: SpendWindow["compute"]["live_pods"][number];
}) {
  return (
    <tr>
      <td>{pod.name}</td>
      <td>
        {/* requests is a `{[key: string]: string}` index signature — cpu/memory keys aren't guaranteed present. */}
        {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
        {pod.requests.cpu ?? "—"} cpu · {pod.requests.memory ?? "—"}
      </td>
      <td>{usd(pod.usd_per_hour)}</td>
      <td>{usd(pod.usd_so_far)}</td>
    </tr>
  );
}

function LivePodTable({ pods }: LivePodsProps) {
  return (
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
        {pods.map((pod) => (
          <LivePodRow key={pod.name} pod={pod} />
        ))}
      </tbody>
    </table>
  );
}

interface LivePodsProps {
  pods: SpendWindow["compute"]["live_pods"];
}

/** What is burning money right now, as opposed to the interval totals below it. */
function LivePods({ pods }: LivePodsProps) {
  return (
    <>
      <h2>Pods Running Now</h2>
      {pods.length === 0 ? (
        <p className="meta">No run pods are live right now.</p>
      ) : (
        <LivePodTable pods={pods} />
      )}
    </>
  );
}

interface ComputeBreakdownsProps {
  compute: SpendWindow["compute"];
  gcpAvailable: boolean;
}

/** Pods burning money right now, and the hours already spent in the interval. */
export function ComputeBreakdowns(props: ComputeBreakdownsProps) {
  const { compute, gcpAvailable } = props;

  return (
    <>
      <LivePods pods={compute.live_pods} />

      <CostTable
        title="Pod-Hours in Interval"
        columns={["Assembly line", "Pods", "Hours", "Est. cost"]}
        rows={compute.pod_hours}
        rowKey={(r) => r.blueprint}
        cells={(r) => [r.blueprint, num(r.pods), num(r.hours), usd(r.est_usd)]}
      />
      <ComputeEstimateNote compute={compute} gcpAvailable={gcpAvailable} />
    </>
  );
}

/** Google's invoice lags a day and is the truth; this is the estimate standing in for it. */
function ComputeEstimateNote(props: ComputeBreakdownsProps) {
  const { compute, gcpAvailable } = props;

  return (
    <p className={`meta ${styles.subnote}`}>
      Compute is an estimate from resource requests × on-demand rates ($
      {compute.rates.cpu_hour_usd}/cpu-h, ${compute.rates.mem_gib_hour_usd}
      /GiB-h); interval pod-hours assume a {compute.assumed_profile.cpu} cpu /{" "}
      {compute.assumed_profile.memory} pod. Google&apos;s invoice lags a day and
      is the truth
      {gcpAvailable
        ? " — the Google Cloud (billed) figures above are that invoice."
        : "."}
    </p>
  );
}
