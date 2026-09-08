import type { PlatformLlmStatus } from "@/lib/api/platform-status";
import styles from "./FailureBlock.module.scss";

/** Whose problem this is: the platform's, not the reader's feature. */
function OutageHeadline() {
  return (
    <p className={styles.headline}>
      Lore&apos;s model access is down — this is a platform outage, not your
      feature.
    </p>
  );
}

/** That waiting is the right move, plus how wide the outage reaches. */
function OutageResumeNote({ affectedRuns }: { affectedRuns: number }) {
  return (
    <p className="meta">
      Agent runs stay parked until it is fixed, and resume on their own
      afterwards — retrying now will not help.
      {affectedRuns > 0 &&
        ` ${affectedRuns} run${affectedRuns === 1 ? "" : "s"} affected in the last 30 minutes.`}
    </p>
  );
}

/** Platform-wide outage notice; renders nothing when healthy (tells user it's account, not their work). */
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
      <OutageHeadline />
      {status.detail && <pre className={styles.diagnosis}>{status.detail}</pre>}
      <OutageResumeNote affectedRuns={status.affected_runs} />
    </div>
  );
}
