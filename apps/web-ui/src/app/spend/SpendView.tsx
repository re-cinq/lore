import type { components } from "@/lib/api/schema";
import type { RecordTopUpState } from "./actions";
import { SummaryCards } from "./SpendSummaryCards";
import { BalanceSection } from "./SpendBalanceSection";
import { LlmBreakdowns } from "./SpendLlmBreakdowns";
import { BilledBreakdowns, ComputeBreakdowns } from "./SpendBilledAndCompute";

export { budgetOutlook } from "./spend-format";

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
