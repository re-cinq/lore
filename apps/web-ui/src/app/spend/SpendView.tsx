import type { components } from "@/lib/api/schema";
import { SummaryCards } from "./SpendSummaryCards";
import { LlmBreakdowns } from "./SpendLlmBreakdowns";
import { BilledBreakdowns, ComputeBreakdowns } from "./SpendBilledAndCompute";

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
      <LlmBreakdowns llm={llm} />
      <BilledBreakdowns billed={billed} gcp={gcp} />
      <ComputeBreakdowns compute={compute} gcpAvailable={gcp.available} />
    </div>
  );
}
