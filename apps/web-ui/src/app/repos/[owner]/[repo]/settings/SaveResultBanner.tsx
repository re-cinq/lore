import type { PrivilegedSaveResult } from "@/lib/mcp-settings";
import styles from "./page.module.css";

export interface SaveState {
  saved: boolean;
  privileged: PrivilegedSaveResult | null;
}

export const INITIAL_SAVE_STATE: SaveState = { saved: false, privileged: null };

function PrivilegedOk() {
  return (
    <p className={styles.savedOk}>
      Privileged changes applied (two-key ceremony recorded).
    </p>
  );
}

function PrivilegedTwoKeyRequired({ fieldPaths }: { fieldPaths: string[] }) {
  return (
    <div className={styles.warn} role="alert">
      <p>These fields are security-gated and need a CODEOWNERS-approved PR:</p>
      <ul>
        {fieldPaths.map((f) => (
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
  );
}

function PrivilegedCodeownersFailed({
  code,
  detail,
}: {
  code: string;
  detail: string;
}) {
  return (
    <p className={styles.warn} role="alert">
      Approval PR check failed ({code}): {detail}
    </p>
  );
}

function PrivilegedUnconfigured() {
  return (
    <p className={styles.warn} role="alert">
      The privileged settings API is not configured, so dark-factory and
      execution-image changes were not applied. General settings were saved.
    </p>
  );
}

function PrivilegedError({ message }: { message: string }) {
  return (
    <p className={styles.warn} role="alert">
      Could not apply privileged changes: {message}
    </p>
  );
}

function renderPrivileged(privileged: PrivilegedSaveResult) {
  switch (privileged.status) {
    case "ok":
      return <PrivilegedOk />;
    case "two_key_required":
      return <PrivilegedTwoKeyRequired fieldPaths={privileged.fieldPaths} />;
    case "codeowners_failed":
      return (
        <PrivilegedCodeownersFailed
          code={privileged.code}
          detail={privileged.detail}
        />
      );
    case "unconfigured":
      return <PrivilegedUnconfigured />;
    case "error":
      return <PrivilegedError message={privileged.message} />;
  }
}

function PrivilegedFeedback({
  privileged,
}: {
  privileged: PrivilegedSaveResult | null;
}) {
  return privileged ? renderPrivileged(privileged) : null;
}

/** Feedback banner for settings save; general fields persist directly; privileged fields gate through two-key API. */
export default function SaveResultBanner({ state }: { state: SaveState }) {
  if (!state.saved) {
    return null;
  }

  return (
    <div className={styles.banner} role="status">
      <p className={styles.savedOk}>Settings saved.</p>
      <PrivilegedFeedback privileged={state.privileged} />
    </div>
  );
}
