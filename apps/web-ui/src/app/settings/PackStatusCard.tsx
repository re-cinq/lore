import { SubmitButton } from "@/components/SubmitButton";
import { SettingsCard } from "@/components/SettingsCard";
import type { PackSync } from "@/lib/api/pack";
import styles from "./PackStatusCard.module.css";

export interface PackStatusCardProps {
  pack: PackSync;
  /** The web address of the GitHub this install talks to, such as https://github.com. */
  githubWebUrl: string;
  syncPack: (formData: FormData) => void | Promise<void>;
}

const SHORT_COMMIT_LENGTH = 7;

/** The client's pack repo and what its last sync applied (specs/client-packs FR-006). */
export default function PackStatusCard({
  pack,
  githubWebUrl,
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
      <PackFooter pack={pack} githubWebUrl={githubWebUrl} syncPack={syncPack} />
    </SettingsCard>
  );
}

function PackFooter({ pack, githubWebUrl, syncPack }: PackStatusCardProps) {
  return (
    <form action={syncPack} className={styles.footer}>
      <LastApplied pack={pack} />
      <div className={styles.actions}>
        <a
          href={packRepoUrl(githubWebUrl, pack)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.repoLink}
        >
          Open repo
        </a>
        <SubmitButton pendingLabel="Syncing…">Sync now</SubmitButton>
      </div>
    </form>
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
        <StatusPill pack={pack} />
      </div>
      {pack.error && <p className={styles.error}>{pack.error}</p>}
    </>
  );
}

function LastApplied({ pack }: { pack: PackSync }) {
  if (pack.commit === null) {
    return <p className={styles.commitInfo}>Not synced yet</p>;
  }

  return (
    <p className={styles.commitInfo}>
      Last applied: {pack.commit.slice(0, SHORT_COMMIT_LENGTH)} &middot;{" "}
      {utcMinute(pack.applied_at)}
    </p>
  );
}

function StatusPill({ pack }: { pack: PackSync }) {
  const failed = pack.error !== null;

  return (
    <span className={`${styles.pill} ${failed ? styles.failed : ""}`}>
      {pillLabel(pack)}
    </span>
  );
}

function pillLabel(pack: PackSync): string {
  if (pack.error !== null) {
    return "Failed";
  }

  return pack.commit === null ? "Waiting" : "Applied";
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

/** The pack's branch on GitHub, or the repository itself when the pack reads the default branch. */
function packRepoUrl(githubWebUrl: string, pack: PackSync): string {
  const repo = `${githubWebUrl}/${pack.repo}`;

  return pack.ref ? `${repo}/tree/${pack.ref}` : repo;
}
