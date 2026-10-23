import Skeleton from "@/components/Skeleton";
import styles from "./LoopsPage.module.scss";

/** What a loop's page shows while its lists are read: two grey tables where its groups will be, named for screen readers. */
export default function LoopBodyLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${label}`}
      data-testid="loop-body-loading"
      className={styles.loading}
    >
      {[3, 2].map((rows, i) => (
        <div className="spec-card" key={i}>
          <Skeleton width="20%" height={18} />
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton width={`${90 - row * 12}%`} key={row} />
          ))}
        </div>
      ))}
    </div>
  );
}
