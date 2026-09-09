export const dynamic = "force-dynamic";
import { recordTopUpAction } from "./actions";
import SpendWindowPanel from "./SpendWindowPanel";
import styles from "./SpendView.module.css";

// Interval-scoped view; server provides static chrome and top-up action
export default function SpendPage() {
  return (
    <div>
      <h1>Claude API Spend</h1>
      <p className={`meta ${styles.subnote}`}>
        Figures are Lore-computed from <code>pipeline.llm_calls</code> token
        counts (input/output × per-model pricing, cache-adjusted).
        Anthropic&apos;s authoritative billed total needs an admin key and
        appears only when one is configured.
      </p>
      <SpendWindowPanel recordAction={recordTopUpAction} />
    </div>
  );
}
