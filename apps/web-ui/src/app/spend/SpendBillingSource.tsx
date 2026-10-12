import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num } from "./spend-format";
import { CostTable } from "./CostTable";

type ByBillingMode = SpendWindow["llm"]["by_billing_mode"];
type BillingMode = ByBillingMode[number]["mode"];

const SOURCE_LABELS: Record<BillingMode, string> = {
  api_key: "API key (org account)",
  subscription: "Subscription (personal credential)",
  unknown: "Unknown (agent named no credential)",
};

/** The API-vs-subscription split of metered spend, so a reader can tell how much of the figure the Anthropic invoice can even see. */
interface BillingSourceProps {
  byBillingMode: ByBillingMode;
  floorUnavailable?: boolean;
}

export function BillingSource({
  byBillingMode,
  floorUnavailable = false,
}: BillingSourceProps) {
  if (byBillingMode.length === 0) {
    return null;
  }

  return (
    <>
      <CostTable
        title="Billing Source"
        columns={["Source", "Calls", "Cost"]}
        rows={byBillingMode}
        rowKey={(r) => r.mode}
        cells={sourceCells}
      />
      <BillingSourceNotes floorUnavailable={floorUnavailable} />
    </>
  );
}

function sourceCells(row: ByBillingMode[number]) {
  return [SOURCE_LABELS[row.mode], num(row.calls), usd(row.cost_usd)];
}

function BillingSourceNotes({
  floorUnavailable,
}: {
  floorUnavailable: boolean;
}) {
  return (
    <>
      {floorUnavailable && <FloorUnavailableNote />}
      <BillingSourceNote />
    </>
  );
}

function BillingSourceNote() {
  return (
    <p className={`meta ${styles.subnote}`}>
      Lore&apos;s own model calls run on the org&apos;s API key; each agent run
      on the floor counts as one call, under the credential its agent reported
      when it started. The billed figure covers only the API-key portion —
      subscription runs bill each person&apos;s own account, so they never reach
      the org invoice.
    </p>
  );
}

function FloorUnavailableNote() {
  return (
    <p className={`meta ${styles.subnote}`}>
      Floor costs unavailable: only Lore&apos;s own model calls are counted.
    </p>
  );
}
