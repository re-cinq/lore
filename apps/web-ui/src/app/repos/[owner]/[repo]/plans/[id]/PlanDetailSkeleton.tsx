import Skeleton from "@/components/Skeleton";
import styles from "./PlanDetailSkeleton.module.scss";

/** The plan page before its data: the header, the run card and the editor, shaped like the page so nothing jumps when the content arrives. */
export default function PlanDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading plan">
      <PlanHeaderSkeleton />
      <PlanRunSkeleton />
      <PlanBodySkeleton />
    </div>
  );
}

/** The facts line on the left; the status badge and Delete button on the right. */
export function PlanHeaderSkeleton() {
  return (
    <div className={styles.header} aria-hidden>
      <Skeleton width="45%" />
      <div className={styles.headerActions}>
        <Skeleton width={72} height={22} />
        <Skeleton width={96} height={30} />
      </div>
    </div>
  );
}

/** The run card: its summary line, then its next step. */
export function PlanRunSkeleton() {
  return (
    <div className={`spec-card ${styles.run}`} aria-hidden>
      <Skeleton width="55%" />
      <Skeleton width="30%" height={30} />
    </div>
  );
}

const OUTLINE_WIDTHS = ["80%", "65%", "90%", "55%", "70%"];
const BODY_WIDTHS = ["95%", "88%", "92%", "60%", "85%", "90%", "40%"];

/** The editor: a body of uneven lines under a heading, with a narrow outline on its right. */
export function PlanBodySkeleton() {
  return (
    <div className={styles.body} aria-hidden>
      <div className={styles.document}>
        <Skeleton width="35%" height={22} />
        {BODY_WIDTHS.map((width, i) => (
          <Skeleton width={width} key={i} />
        ))}
      </div>
      <div className={styles.outline}>
        {OUTLINE_WIDTHS.map((width, i) => (
          <Skeleton width={width} key={i} />
        ))}
      </div>
    </div>
  );
}
