export const dynamic = "force-dynamic";
import SpendWindowPanel from "./SpendWindowPanel";
import { UsageHeader } from "../analytics/UsageHeader";

// Interval-scoped view; server provides the static chrome
export default function SpendPage() {
  return (
    <div>
      <UsageHeader
        active="spend"
        lede={
          <>
            Figures are Lore-computed from <code>pipeline.llm_calls</code> token
            counts (input/output × per-model pricing, cache-adjusted).
            Anthropic&apos;s authoritative billed total needs an admin key and
            appears only when one is configured.
          </>
        }
      />
      <SpendWindowPanel />
    </div>
  );
}
