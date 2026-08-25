import type { PlatformLlmStatus } from "@/lib/api/platform-status";
import styles from "./FailureBlock.module.scss";

/**
 * Pure: the platform-wide outage notice that sits above a feature's own state.
 *
 * It renders nothing at all when the platform is healthy, which is almost always
 * — the point is that on the rare day it is not, the person reading a failed
 * round is told the cause is the account rather than their work, before they
 * spend another three minutes retrying into it.
 */
export default function PlatformOutageBanner({
  status,
}: {
  status: PlatformLlmStatus;
}) {
  if (!status.degraded) {
    return null;
  }

  return (
    <div className={`spec-card ${styles.failure}`} role="alert">
      <p className={styles.headline}>
        Lore&apos;s model access is down — this is a platform outage, not your
        feature.
      </p>
      {status.detail && <pre className={styles.diagnosis}>{status.detail}</pre>}
      <p className="meta">
        Agent runs stay parked until it is fixed, and resume on their own
        afterwards — retrying now will not help.
        {status.affected_runs > 0 &&
          ` ${status.affected_runs} run${status.affected_runs === 1 ? "" : "s"} affected in the last 30 minutes.`}
      </p>
    </div>
  );
}
