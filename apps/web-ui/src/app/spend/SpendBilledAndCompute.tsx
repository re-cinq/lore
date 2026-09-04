import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num, day } from "./spend-format";
import { CostTable } from "./CostTable";

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
export function ComputeBreakdowns({
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
