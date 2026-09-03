import styles from "./loading.module.scss";
import Skeleton from "@/components/Skeleton";

// Fallback for repo segment; tab subroutes have no closer loading.tsx, so stay tab-neutral (no overview-specific text).
export default function RepoLoading() {
  return (
    <div role="status" aria-label="Loading repository">
      <div className={`spec-card ${styles.card}`}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton width={`${85 - i * 10}%`} key={i} />
        ))}
      </div>
      <div className="spec-card">
        <Skeleton width="30%" height={18} />
        <div className={styles.stats}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton width={72} height={34} key={i} />
          ))}
        </div>
      </div>
      <Skeleton width="25%" height={20} className={styles.sectionHeading} />
      <div className={styles.rows}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} />
        ))}
      </div>
      <Skeleton width="25%" height={20} className={styles.sectionHeading} />
      <div className={styles.rows}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} />
        ))}
      </div>
    </div>
  );
}
