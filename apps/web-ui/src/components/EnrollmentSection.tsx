import { type Check, type CheckStatus, passSummary } from "@/lib/enrollment";
import HelpPopover from "./HelpPopover";
import CopyButton from "./CopyButton";
import SecretReveal from "./SecretReveal";
import ReonboardButton from "./ReonboardButton";
import SetupWebhookButton from "./SetupWebhookButton";
import Icon from "./Icon";
import type { IconName } from "@/lib/icon-map";
import styles from "./EnrollmentSection.module.css";

const STATUS: Record<CheckStatus, { icon: IconName; color: string }> = {
  pass: { icon: "check", color: "var(--success)" },
  warn: { icon: "warning", color: "var(--warning)" },
  fail: { icon: "error", color: "var(--danger)" },
  unknown: { icon: "unknown", color: "var(--text-muted)" },
};

function ReonboardAction({
  check,
  reonboardAction,
}: {
  check: Check;
  reonboardAction?: () => Promise<void>;
}) {
  if (check.action?.kind !== "reonboard" || !reonboardAction) {
    return null;
  }

  return <ReonboardButton action={reonboardAction} text={check.action.text} />;
}

function SetupWebhookAction({
  check,
  setupWebhookAction,
}: {
  check: Check;
  setupWebhookAction?: () => Promise<void>;
}) {
  if (check.action?.kind !== "setup-webhook" || !setupWebhookAction) {
    return null;
  }

  return (
    <SetupWebhookButton action={setupWebhookAction} text={check.action.text} />
  );
}

function CheckCopy({ check }: { check: Check }) {
  if (!check.copy) {
    return null;
  }

  return (
    <span className={styles.copyUrl}>
      {check.copy.label && <span className="meta">{check.copy.label}:</span>}
      <code className={styles.copyUrlValue}>{check.copy.value}</code>
      <CopyButton text={check.copy.value} />
    </span>
  );
}

interface CheckRowProps {
  check: Check;
  reonboardAction?: () => Promise<void>;
  setupWebhookAction?: () => Promise<void>;
}

/** The pass/fail marker. Colour rides through a CSS variable rather than a class per status, so a new status needs a STATUS entry and no stylesheet change. */
function CheckStatusIcon({ status }: { status: Check["status"] }) {
  const shown = STATUS[status];

  return (
    <span
      className={styles.statusIcon}
      style={{ ["--status-color" as string]: shown.color }}
    >
      <Icon name={shown.icon} size={14} />
    </span>
  );
}

/** What this check found, and where to go look. Both are optional: a passing check usually has nothing to add, and saying so would be noise on every row. */
function CheckDetail({ check }: { check: Check }) {
  return (
    <>
      {check.detail && (
        <span className={`meta ${styles.detail}`}>{check.detail}</span>
      )}
      {check.link && (
        <a
          href={check.link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          {check.link.text}
        </a>
      )}
    </>
  );
}

function CheckRow({
  check,
  reonboardAction,
  setupWebhookAction,
}: CheckRowProps) {
  return (
    <div className="enroll-row">
      <CheckStatusIcon status={check.status} />
      <span className={styles.label}>{check.label}</span>
      <span className="enroll-dots" />
      <CheckDetail check={check} />
      <ReonboardAction check={check} reonboardAction={reonboardAction} />
      <SetupWebhookAction
        check={check}
        setupWebhookAction={setupWebhookAction}
      />
      <CheckCopy check={check} />
      {check.secret && (
        <SecretReveal value={check.secret.value} label={check.secret.label} />
      )}
    </div>
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

function Step({
  label,
  note,
  command,
  alt,
}: {
  label: string;
  note?: string;
  command: string;
  alt?: { label: string; command: string };
}) {
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

const INSTALL_CMD =
  "git clone git@github.com:re-cinq/lore.git && cd lore && scripts/install.sh";
const CURL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/re-cinq/lore/main/scripts/install.sh | bash";

export default function EnrollmentSection({
  checks,
  reonboardAction,
  setupWebhookAction,
}: EnrollmentSectionProps) {
  const { passed, total } = passSummary(checks);

  return (
    <div className={`spec-card ${styles.section}`}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Enrollment</h3>
        <EnrollmentHelp />
        <span className={`meta ${styles.summary}`}>
          {passed}/{total} checks passing
        </span>
      </div>

      <div className={`meta ${styles.groupLabel}`}>Repo integration</div>
      <div className={styles.checks}>
        <CheckRows
          checks={checks}
          reonboardAction={reonboardAction}
          setupWebhookAction={setupWebhookAction}
        />
      </div>

      <LocalSetupSteps />
    </div>
  );
}

interface EnrollmentSectionProps {
  checks: Check[];
  reonboardAction?: () => Promise<void>;
  setupWebhookAction?: () => Promise<void>;
}

/** Every repo-integration check, each carrying whichever fix action applies to it. */
function CheckRows({
  checks,
  reonboardAction,
  setupWebhookAction,
}: EnrollmentSectionProps) {
  return checks.map((check) => (
    <CheckRow
      key={check.id}
      check={check}
      reonboardAction={reonboardAction}
      setupWebhookAction={setupWebhookAction}
    />
  ));
}

function EnrollmentHelp() {
  return (
    <HelpPopover label="What enrollment checks mean">
      <p>
        These checks show whether this repo is wired into Lore and whether
        you&apos;ve set it up locally.
      </p>
      <ul>
        <li>
          <strong>Repo integration</strong> is verified from Lore&apos;s
          database and (where the GitHub App has access) the repo&apos;s files.
          A missing file (e.g. the <code>lore-ingest.yml</code> ingest workflow)
          can be fixed in place — the <em>create a PR with this file</em> action
          queues an onboarding task that opens a PR adding only what&apos;s
          missing.
        </li>
        <li>
          <strong>Used locally via MCP</strong> turns green once a Claude Code
          session for this repo is recorded.
        </li>
        <li>
          The <strong>local setup</strong> steps run on your machine and
          can&apos;t be auto-verified.
        </li>
      </ul>
    </HelpPopover>
  );
}

/** The three commands a developer runs once per machine. Ordered because they depend on each other — the install registers the MCP server the second step then loads. */
function SetupSteps() {
  return (
    <ol className={styles.steps}>
      <Step
        label="Install Lore (once per machine) — configures the MCP server, skills, hooks, statusline, and agent ID."
        note="Needs git, Node.js ≥18, and the Claude Code CLI. Clones into ~/.re-cinq/lore, builds the MCP server, and registers it in your Claude config. Idempotent — safe to re-run."
        command={INSTALL_CMD}
        alt={{
          label: "…or without cloning (private repo needs SSH/token access):",
          command: CURL_CMD,
        }}
      />
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

/** The half nobody can verify for you: these run on your machine, and step 2 is what eventually flips the MCP check green. */
function LocalSetupSteps() {
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
