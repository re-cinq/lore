// The half of enrollment nobody can verify for you: the commands a developer runs once per machine.
import CopyButton from "./CopyButton";
import styles from "./EnrollmentSection.module.css";

const INSTALL_CMD =
  "git clone git@github.com:re-cinq/lore.git && cd lore && scripts/install.sh";
const CURL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/re-cinq/lore/main/scripts/install.sh | bash";

const INSTALL_STEP = {
  label:
    "Install Lore (once per machine) — configures the MCP server, skills, hooks, statusline, and agent ID.",
  note: "Needs git, Node.js ≥18, and the Claude Code CLI. Clones into ~/.re-cinq/lore, builds the MCP server, and registers it in your Claude config. Idempotent — safe to re-run.",
  command: INSTALL_CMD,
  alt: {
    label: "…or without cloning (private repo needs SSH/token access):",
    command: CURL_CMD,
  },
};

/** Step 2 is what eventually flips the MCP check green. */
export default function LocalSetupSteps() {
  return (
    <>
      <div className={`meta ${styles.groupLabel}`}>Your local setup</div>
      <SetupSteps />
      <p className={`meta ${styles.footnote}`}>
        These run on your machine and aren&apos;t auto-verified — completing
        step 2 flips <strong>Used locally via MCP</strong> green once a session
        summary is recorded.
      </p>
    </>
  );
}

/** The three commands a developer runs once per machine. Ordered because they depend on each other — the install registers the MCP server the second step then loads. */
function SetupSteps() {
  return (
    <ol className={styles.steps}>
      <Step {...INSTALL_STEP} />
      <Step
        label="Open this repo and start Claude Code — org context loads automatically."
        command="claude"
      />
      <Step
        label="Verify context loads."
        command={'claude "how do we handle auth in this repo?"'}
      />
    </ol>
  );
}

interface StepProps {
  label: string;
  note?: string;
  command: string;
  alt?: { label: string; command: string };
}

function Step({ label, note, command, alt }: StepProps) {
  return (
    <li className={styles.step}>
      <div className={styles.stepLabel}>{label}</div>
      {note && <div className={`meta ${styles.stepNote}`}>{note}</div>}
      <CommandRow command={command} />
      {alt && (
        <>
          <div className={`meta ${styles.altLabel}`}>{alt.label}</div>
          <CommandRow command={alt.command} />
        </>
      )}
    </li>
  );
}

function CommandRow({ command }: { command: string }) {
  return (
    <div className={styles.commandRow}>
      <pre className={styles.command}>{command}</pre>
      <CopyButton text={command} />
    </div>
  );
}
