import styles from "./loading.module.scss";
import Skeleton from "@/components/Skeleton";

export default function SearchLoading() {
  return (
    <div role="status" aria-label="Loading search">
      <h1>Search Memories</h1>
      <div className={styles.page}>
        <Skeleton height={38} />
        {Array.from({ length: 3 }, (_, i) => (
          <div className={`search-result ${styles.result}`} key={i}>
            <Skeleton width="40%" height={16} />
            <Skeleton width="90%" />
            <Skeleton width="70%" />
          </div>
        ))}
      </div>
    </div>
  );
}
