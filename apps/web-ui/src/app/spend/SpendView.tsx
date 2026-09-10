import type { components } from "@/lib/api/schema";
import { SummaryCards } from "./SpendSummaryCards";
import { LlmBreakdowns } from "./SpendLlmBreakdowns";
import { BilledBreakdowns, ComputeBreakdowns } from "./SpendBilledAndCompute";
import { SpendSection } from "./SpendSection";
import { SpendCompareBars, type ComparePairInput } from "./SpendCompareBars";
import { SpendTrendChart } from "./SpendTrendChart";

// Rows are aliases over OpenAPI /api/analytics/spend-window contract (ADR-035)
export type SpendWindow = components["schemas"]["SpendWindow"];

export interface SpendViewProps {
  spend: SpendWindow;
}

export default function SpendView({ spend }: SpendViewProps) {
  const { llm, billed, gcp, compute } = spend;

  return (
    <div>
      <SummaryCards {...spend} />
      <SpendCompareBars pairs={comparePairs(spend)} />
      <LoreComputedSection llm={llm} />
      {(billed.available || gcp.available) && (
        <VendorInvoicesSection billed={billed} gcp={gcp} />
      )}
      <ComputeSection compute={compute} gcpAvailable={gcp.available} />
    </div>
  );
}

/** The two estimate-vs-billed comparisons, each dropped by SpendCompareBars until its billed side exists. */
function comparePairs(spend: SpendWindow): ComparePairInput[] {
  const { llm, billed, gcp, compute } = spend;

  return [
    {
      label: "LLM — Anthropic",
      estimate: anthropicEstimate(llm),
      billed: billed.available ? billed.total_usd : null,
    },
    {
      label: "Kubernetes — Google Cloud",
      estimate: compute.est_total_usd,
      billed: gcp.available ? gcp.total_usd : null,
    },
  ];
}

/** The Anthropic slice of what Lore metered — the only computed figure comparable to Anthropic's invoice, since other vendors bill their own account. Falls back to the LLM total when no vendor split exists. */
function anthropicEstimate(llm: SpendWindow["llm"]): number {
  const anthropic = llm.by_vendor.find((v) => v.vendor === "anthropic");

  return anthropic ? anthropic.cost_usd : llm.total_usd;
}

function LoreComputedSection({ llm }: { llm: SpendWindow["llm"] }) {
  return (
    <SpendSection
      title="Lore-computed LLM spend"
      kind="estimate"
      caption="Metered from token counts (input/output × per-model pricing, cache-adjusted). The vendor invoice is the authority; this is the live estimate beside it."
    >
      <h2>Daily Cost Trend</h2>
      <SpendTrendChart daily={llm.daily} />
      <LlmBreakdowns llm={llm} />
    </SpendSection>
  );
}

function VendorInvoicesSection({
  billed,
  gcp,
}: {
  billed: SpendWindow["billed"];
  gcp: SpendWindow["gcp"];
}) {
  return (
    <SpendSection
      title="Vendor invoices"
      kind="billed"
      caption="What Anthropic and Google Cloud actually billed. A vendor appears only once its billing export is wired up."
    >
      <BilledBreakdowns billed={billed} gcp={gcp} />
    </SpendSection>
  );
}

function ComputeSection({
  compute,
  gcpAvailable,
}: {
  compute: SpendWindow["compute"];
  gcpAvailable: boolean;
}) {
  return (
    <SpendSection
      title="Kubernetes compute"
      kind="estimate"
      caption="An estimate from pod resource requests × on-demand rates. Google Cloud's invoice above is the truth once it syncs."
    >
      <ComputeBreakdowns compute={compute} gcpAvailable={gcpAvailable} />
    </SpendSection>
  );
}
