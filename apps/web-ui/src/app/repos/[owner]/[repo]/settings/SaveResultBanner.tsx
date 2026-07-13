import type { PrivilegedSaveResult } from "@/lib/mcp-settings";
import styles from "./page.module.css";

export interface SaveState {
  saved: boolean;
  privileged: PrivilegedSaveResult | null;
}

export const INITIAL_SAVE_STATE: SaveState = { saved: false, privileged: null };

/**
 * Pure feedback banner for the settings save. General fields persist directly;
 * privileged (dark_factory / execution.image) fields route through the two-key
 * gated API, so their outcome — applied, blocked pending a CODEOWNERS PR, or an
 * error — is surfaced separately.
 */
export default function SaveResultBanner({ state }: { state: SaveState }) {
  if (!state.saved) return null;
  const p = state.privileged;
  return (
    <div className={styles.banner} role="status">
      <p className={styles.savedOk}>Settings saved.</p>
      {p?.status === "ok" && (
        <p className={styles.savedOk}>
          Privileged changes applied (two-key ceremony recorded).
        </p>
      )}
      {p?.status === "two_key_required" && (
        <div className={styles.warn} role="alert">
          <p>
            These fields are security-gated and need a CODEOWNERS-approved PR:
          </p>
          <ul>
            {p.fieldPaths.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
          <p>
            Open a PR labeled <code>dark-factory-approval</code> approved by a
            CODEOWNER of this repo&apos;s <code>CLAUDE.md</code>, enter it as{" "}
            <code>owner/repo#N</code> in the Approval PR field above, and save
            again. General settings were saved.
          </p>
        </div>
      )}
      {p?.status === "codeowners_failed" && (
        <p className={styles.warn} role="alert">
          Approval PR check failed ({p.code}): {p.detail}
        </p>
      )}
      {p?.status === "unconfigured" && (
        <p className={styles.warn} role="alert">
          The privileged settings API is not configured, so dark-factory and
          execution-image changes were not applied. General settings were saved.
        </p>
      )}
      {p?.status === "error" && (
        <p className={styles.warn} role="alert">
          Could not apply privileged changes: {p.message}
        </p>
      )}
    </div>
  );
}
