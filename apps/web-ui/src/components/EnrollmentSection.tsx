import { type Check, type CheckStatus, passSummary } from "@/lib/enrollment";
import HelpPopover from "./HelpPopover";
import CopyButton from "./CopyButton";
import SecretReveal from "./SecretReveal";
import ReonboardButton from "./ReonboardButton";
import SetupWebhookButton from "./SetupWebhookButton";
import Icon from "./Icon";
import type { IconName } from "./icon-map";
import styles from "./EnrollmentSection.module.css";

const STATUS: Record<CheckStatus, { icon: IconName; color: string }> = {
  pass: { icon: "check", color: "var(--success)" },
  warn: { icon: "warning", color: "var(--warning)" },
  fail: { icon: "error", color: "var(--danger)" },
  unknown: { icon: "unknown", color: "var(--text-muted)" },
};

function CheckRow({
  check,
  reonboardAction,
  setupWebhookAction,
}: {
  check: Check;
  reonboardAction?: () => Promise<void>;
  setupWebhookAction?: () => Promise<void>;
}) {
  const s = STATUS[check.status];
  return (
    <div className="enroll-row">
      <span className={styles.statusIcon} style={{ color: s.color }}>
        <Icon name={s.icon} size={14} />
      </span>
      <span className={styles.label}>{check.label}</span>
      <span className="enroll-dots" />
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
      {check.action?.kind === "reonboard" && reonboardAction && (
        <ReonboardButton action={reonboardAction} text={check.action.text} />
      )}
      {check.action?.kind === "setup-webhook" && setupWebhookAction && (
        <SetupWebhookButton
          action={setupWebhookAction}
          text={check.action.text}
        />
      )}
      {check.copy && (
        <span className={styles.copyUrl}>
          {check.copy.label && (
            <span className="meta">{check.copy.label}:</span>
          )}
          <code className={styles.copyUrlValue}>{check.copy.value}</code>
          <CopyButton text={check.copy.value} />
        </span>
      )}
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
}: {
  checks: Check[];
  reonboardAction?: () => Promise<void>;
  setupWebhookAction?: () => Promise<void>;
}) {
  const { passed, total } = passSummary(checks);

  return (
    <div className={`spec-card ${styles.section}`}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Enrollment</h3>
        <HelpPopover label="What enrollment checks mean">
          <p>
            These checks show whether this repo is wired into Lore and whether
            you&apos;ve set it up locally.
          </p>
          <ul>
            <li>
              <strong>Repo integration</strong> is verified from Lore&apos;s
              database and (where the GitHub App has access) the repo&apos;s
              files. A missing file (e.g. the <code>lore-ingest.yml</code>{" "}
              ingest workflow) can be fixed in place — the{" "}
              <em>create a PR with this file</em> action queues an onboarding
              task that opens a PR adding only what&apos;s missing.
            </li>
            <li>
              <strong>Used locally via MCP</strong> turns green once a Claude
              Code session for this repo is recorded.
            </li>
            <li>
              The <strong>local setup</strong> steps run on your machine and
              can&apos;t be auto-verified.
            </li>
          </ul>
        </HelpPopover>
        <span className={`meta ${styles.summary}`}>
          {passed}/{total} checks passing
        </span>
      </div>

      <div className={`meta ${styles.groupLabel}`}>Repo integration</div>
      <div className={styles.checks}>
        {checks.map((c) => (
          <CheckRow
            key={c.id}
            check={c}
            reonboardAction={reonboardAction}
            setupWebhookAction={setupWebhookAction}
          />
        ))}
      </div>

      <div className={`meta ${styles.groupLabel}`}>Your local setup</div>
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
      <p className={`meta ${styles.footnote}`}>
        These run on your machine and aren&apos;t auto-verified — completing
        step 2 flips <strong>Used locally via MCP</strong> green once a session
        summary is recorded.
      </p>
    </div>
  );
}
