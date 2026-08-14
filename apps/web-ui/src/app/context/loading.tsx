import styles from "./loading.module.scss";
import Skeleton from "@/components/Skeleton";

export default function ContextLoading() {
  return (
    <div role="status" aria-label="Loading context">
      <h1>Context</h1>
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
