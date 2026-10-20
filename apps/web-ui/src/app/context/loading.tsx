import styles from "./loading.module.scss";
import Skeleton from "@/components/Skeleton";
import ScreenHeader from "@/components/ScreenHeader";

export default function ContextLoading() {
  return (
    <div role="status" aria-label="Loading context">
      <ScreenHeader group="knowledge" title="Context" />
      <div className={styles.chips}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton width={72} height={26} key={i} className={styles.chip} />
        ))}
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div className={`spec-card ${styles.card}`} key={i}>
          <Skeleton width="50%" height={16} />
          <Skeleton width="95%" />
          <Skeleton width="80%" />
        </div>
      ))}
    </div>
  );
}
