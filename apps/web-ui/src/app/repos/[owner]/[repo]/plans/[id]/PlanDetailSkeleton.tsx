import Skeleton from "@/components/Skeleton";
import styles from "./PlanDetailSkeleton.module.scss";

/** The plan page before its data: the toolbar and the editor, shaped like the page so nothing jumps when the content arrives. */
export default function PlanDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading plan">
      <PlanToolbarSkeleton />
      <PlanBodySkeleton />
    </div>
  );
}

/** The toolbar: badge and facts on the left; the run's text, the Open the run link, Regenerate plan and the actions menu on the right. */
export function PlanToolbarSkeleton() {
  return (
    <div className={styles.toolbar} aria-hidden>
      <Skeleton width={72} height={22} />
      <Skeleton width={220} />
      <div className={styles.toolbarActions}>
        <Skeleton width={240} />
        <Skeleton width={120} height={30} />
        <Skeleton width={130} height={30} />
        <Skeleton width={34} height={30} />
      </div>
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
