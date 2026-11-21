import Skeleton from "@/components/Skeleton";
import styles from "./DraftingPlan.module.scss";

/** Stands in for the editor while the planning agent writes the first draft, which would overwrite anything typed meanwhile; the plan-run channel moves the page on once the draft starts. */
export default function DraftingPlan() {
  return (
    <div className={`spec-card ${styles.drafting}`}>
      <p role="status" className="meta">
        The planning agent is writing this plan. It opens here as soon as the
        draft is ready.
      </p>
      <Skeleton width="40%" height={20} />
      <Skeleton />
      <Skeleton width="85%" />
      <Skeleton width="60%" />
    </div>
  );
}
