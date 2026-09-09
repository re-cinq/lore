import { type Check, type CheckStatus, passSummary } from "@/lib/enrollment";
import EnrollmentHelp from "./EnrollmentHelp";
import LocalSetupSteps from "./LocalSetupSteps";
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

/** Whichever fix actions this check offers; each renders nothing when it does not apply. */
function CheckActions({
  check,
  reonboardAction,
  setupWebhookAction,
}: CheckRowProps) {
  return (
    <>
      <ReonboardAction check={check} reonboardAction={reonboardAction} />
      <SetupWebhookAction
        check={check}
        setupWebhookAction={setupWebhookAction}
      />
    </>
  );
}

function CheckSecret({ check }: { check: Check }) {
  if (!check.secret) {
    return null;
  }

  return <SecretReveal value={check.secret.value} label={check.secret.label} />;
}

function CheckRow(props: CheckRowProps) {
  const { check } = props;

  return (
    <div className="enroll-row">
      <CheckStatusIcon status={check.status} />
      <span className={styles.label}>{check.label}</span>
      <span className="enroll-dots" />
      <CheckDetail check={check} />
      <CheckActions {...props} />
      <CheckCopy check={check} />
      <CheckSecret check={check} />
    </div>
  );
}

/** The section title, with how many of the checks are green. */
function EnrollmentHeader({ checks }: { checks: Check[] }) {
  const { passed, total } = passSummary(checks);

  return (
    <div className={styles.header}>
      <h3 className={styles.heading}>Enrollment</h3>
      <EnrollmentHelp />
      <span className={`meta ${styles.summary}`}>
        {passed}/{total} checks passing
      </span>
    </div>
  );
}

export default function EnrollmentSection(props: EnrollmentSectionProps) {
  return (
    <div className={`spec-card ${styles.section}`}>
      <EnrollmentHeader checks={props.checks} />

      <div className={`meta ${styles.groupLabel}`}>Repo integration</div>
      <div className={styles.checks}>
        <CheckRows {...props} />
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
