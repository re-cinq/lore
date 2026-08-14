"use client";

import styles from "./RouteError.module.scss";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="empty-state" role="alert">
      <h2>Something went wrong</h2>
      <p>
        {error.message ||
          "An unexpected error occurred while loading this page."}
      </p>
      <button onClick={reset} className={styles.retry}>
        Try again
      </button>
    </div>
  );
}
