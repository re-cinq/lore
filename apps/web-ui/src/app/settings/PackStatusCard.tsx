import { SubmitButton } from "@/components/SubmitButton";
import { SettingsCard } from "@/components/SettingsCard";
import type { PackSync } from "@/lib/api/pack";
import styles from "./PackStatusCard.module.css";

export interface PackStatusCardProps {
  pack: PackSync;
  syncPack: (formData: FormData) => void | Promise<void>;
}

const SHORT_COMMIT_LENGTH = 7;

/** The client's pack repo and what its last sync applied (specs/client-packs FR-006). */
export default function PackStatusCard({
  pack,
  syncPack,
}: PackStatusCardProps) {
  return (
    <SettingsCard id="set-pack" title="Pack">
      <PackHeader pack={pack} />
      <div className={styles.stats}>
        <Stat label="agents" value={pack.agent_count} />
        <Stat label="lines" value={pack.line_count} />
        <Stat label="extras" value={pack.extra_count} />
      </div>
      <RefusedFiles files={pack.refused_files} />
      <form action={syncPack} className={styles.footer}>
        <LastApplied pack={pack} />
        <SubmitButton pendingLabel="Syncing…">Sync now</SubmitButton>
      </form>
    </SettingsCard>
  );
}

function PackHeader({ pack }: { pack: PackSync }) {
  return (
    <>
      <div className={styles.repoRow}>
        <span className={styles.repoName}>{pack.repo}</span>
        <span className={styles.repoRef}>
          branch: {pack.ref ?? "default branch"}
        </span>
        <StatusPill failed={pack.error !== null} />
      </div>
      {pack.error && <p className={styles.error}>{pack.error}</p>}
    </>
  );
}

function LastApplied({ pack }: { pack: PackSync }) {
  return (
    <p className={styles.commitInfo}>
      Last applied: {pack.commit?.slice(0, SHORT_COMMIT_LENGTH)} &middot;{" "}
      {utcMinute(pack.applied_at)}
    </p>
  );
}

function StatusPill({ failed }: { failed: boolean }) {
  return (
    <span className={`${styles.pill} ${failed ? styles.failed : ""}`}>
      {failed ? "Failed" : "Applied"}
    </span>
  );
}

/** Files the last sync skipped; the rest of the pack was still applied. */
function RefusedFiles({ files }: { files: PackSync["refused_files"] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <ul className={styles.refused}>
      {files.map(({ path, reason }) => (
        <li key={path}>
          <span className={styles.refusedPath}>{path}</span>: {reason}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function utcMinute(iso: string | null): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "";
}
