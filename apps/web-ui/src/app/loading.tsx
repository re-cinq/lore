import styles from "./loading.module.scss";
import Skeleton from "@/components/Skeleton";

// Root-level fallback for all routes without closer loading.tsx; generic heading + card grid.
export default function RootLoading() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton width={220} height={26} />
      <div className="repo-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div className={`repo-card ${styles.card}`} key={i}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="45%" />
            <Skeleton width="55%" />
          </div>
        ))}
      </div>
    </div>
  );
}
