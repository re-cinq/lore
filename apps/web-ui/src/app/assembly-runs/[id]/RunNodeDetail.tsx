// Detail card for the selected graph node: plain-language "why" plus supporting facts and links. Pure render over the presenter's output.
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";
import {
  formatDuration,
  formatRelativeTime,
} from "@/lib/assembly-run-presenter";
import { describeNode, type NodeDetail } from "@/lib/run-node-detail-presenter";
import type { NodeStatusTone } from "@/lib/run-node-status";
import type { StepView } from "@/lib/step-presenter";
import CollapsibleCard from "@/components/CollapsibleCard";
import { StatusPill } from "@/components/StatusPill";
import styles from "./RunNodeDetail.module.css";

const WHY_CLASS: Record<NodeStatusTone, string> = {
  ok: styles.whyOk,
  warn: styles.whyWarn,
  err: styles.whyErr,
  running: styles.whyRunning,
  waiting: styles.whyWaiting,
  idle: styles.whyIdle,
};

export interface RunNodeDetailProps {
  nodeId: string;
  state: NodeRunState | undefined;
  row: AssemblyRunNode | undefined;
  definition: AssemblyLineDefinition | null;
  reason: string | null;
  repo: string;
  /** Every walk row of this node in execution order — the loop history. */
  attempts: StepView[];
  /** Header-row actions (the retry button), forwarded to the card's summary. */
  actions?: React.ReactNode;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function RunNodeDetail(props: RunNodeDetailProps) {
  const detail: NodeDetail = describeNode(props);

  return (
    <CollapsibleCard
      defaultOpen
      title={props.nodeId}
      status={{ label: detail.statusLabel, tone: detail.tone }}
      labels={[detail.nodeType]}
      actions={props.actions}
    >
      <p className={`${styles.why} ${WHY_CLASS[detail.tone]}`}>{detail.why}</p>
      <ErroredSteps failures={detail.failures} />
      <NodeFacts detail={detail} repo={props.repo} />
      <AttemptHistory attempts={props.attempts} repo={props.repo} />
      <TouchedFiles files={detail.files} />
    </CollapsibleCard>
  );
}

/** Only a failed node lists these: a succeeded node can carry errored tool calls it retried past, which are the reason for nothing. */
function ErroredSteps({ failures }: { failures: NodeDetail["failures"] }) {
  if (failures.length === 0) {
    return null;
  }

  return (
    <div className={styles.failures}>
      <div className={styles.failuresHead}>
        Errored steps ({failures.length})
      </div>
      <ul className={styles.failList}>
        {failures.map((step, i) => (
          <li key={i} className={styles.failItem}>
            <span className={styles.failTool}>{step.tool}</span>
            <span className={styles.failDetail}>{step.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StartedAtFact({ startedAt }: { startedAt: string | null }) {
  if (!startedAt) {
    return <Fact label="Started">—</Fact>;
  }

  return (
    <Fact label="Started">
      <time dateTime={startedAt} title={startedAt}>
        {formatRelativeTime(startedAt)}
      </time>
    </Fact>
  );
}

function transcriptSummary(detail: NodeDetail): string {
  const eventLabel = `${detail.eventCount} event${detail.eventCount === 1 ? "" : "s"}`;
  const droppedLabel =
    detail.droppedCount > 0 ? ` (+${detail.droppedCount} dropped)` : "";

  return `${eventLabel}${droppedLabel}`;
}

function AgentCrFact({ agentCrName }: { agentCrName: string | null }) {
  if (!agentCrName) {
    return null;
  }

  return (
    <Fact label="Agent CR">
      <span className={styles.mono}>{agentCrName}</span>
    </Fact>
  );
}

function CommitFact({
  commitSha,
  repo,
}: {
  commitSha: string | null;
  repo: string;
}) {
  if (!commitSha) {
    return null;
  }

  return (
    <Fact label="Commit">
      <a
        className={styles.mono}
        href={`https://github.com/${repo}/commit/${commitSha}`}
        target="_blank"
        rel="noreferrer"
      >
        {commitSha.substring(0, 7)}
      </a>
    </Fact>
  );
}

function NodeFacts({ detail, repo }: { detail: NodeDetail; repo: string }) {
  return (
    <dl className={styles.facts}>
      <Fact label="Attempt">{detail.iteration || "—"}</Fact>
      <Fact label="Duration">{detail.durationLabel}</Fact>
      <StartedAtFact startedAt={detail.startedAt} />
      <Fact label="Outcome">{detail.outcomeLabel}</Fact>
      <Fact label="Files touched">{detail.files.length || "—"}</Fact>
      <Fact label="Transcript">{transcriptSummary(detail)}</Fact>
      <AgentCrFact agentCrName={detail.agentCrName} />
      <CommitFact commitSha={detail.commitSha} repo={repo} />
    </dl>
  );
}

/** The stage commit this attempt made, linked to GitHub. Shown short, as a sha is read: the full forty characters carry no more meaning to a human and crowd out the row. */
function CommitLink({ sha, repo }: { sha: string | null; repo: string }) {
  if (!sha) {
    return null;
  }

  return (
    <a
      className={styles.mono}
      href={`https://github.com/${repo}/commit/${sha}`}
      target="_blank"
      rel="noreferrer"
    >
      {sha.substring(0, 7)}
    </a>
  );
}

/** What an attempt left behind: the pod that ran it, the commit it made, the edge it took, and why. Each is omitted when absent rather than rendered blank — an attempt that never reached a pod has no CR name, and an empty slot would read as one that failed to load. */
function AttemptRefs({
  step,
  repo,
}: {
  step: RunNodeDetailProps["attempts"][number];
  repo: string;
}) {
  return (
    <>
      {step.agentCrName ? (
        <span className={`${styles.attemptMeta} ${styles.mono}`}>
          {step.agentCrName}
        </span>
      ) : null}
      <CommitLink sha={step.commitSha} repo={repo} />
      {step.transition ? (
        <span className={styles.attemptEdge}>{step.transition}</span>
      ) : null}
      {step.reason ? (
        <span className={styles.attemptReason}>{step.reason}</span>
      ) : null}
    </>
  );
}

/** One attempt. Every field past the status pill is optional and omitted when absent rather than rendered blank — an attempt that never reached a pod has no CR name, and an empty slot would read as a name that failed to load. */
function AttemptRow({
  step,
  repo,
}: {
  step: RunNodeDetailProps["attempts"][number];
  repo: string;
}) {
  return (
    <li className={styles.attemptItem}>
      <span className={styles.attemptMeta}>attempt {step.iteration}</span>
      <StatusPill label={step.label} tone={step.tone} />
      <span className={styles.attemptMeta}>
        {formatDuration(step.durationSeconds)}
      </span>
      <AttemptRefs step={step} repo={repo} />
    </li>
  );
}

/** Only shown once a node has been visited more than once — a single attempt is already the card above. */
function AttemptHistory({
  attempts,
  repo,
}: {
  attempts: RunNodeDetailProps["attempts"];
  repo: string;
}) {
  if (attempts.length <= 1) {
    return null;
  }

  return (
    <div className={styles.attempts}>
      <div className={styles.attemptsHead}>Attempts ({attempts.length})</div>
      <ol className={styles.attemptList}>
        {attempts.map((step) => (
          <AttemptRow key={step.iteration} step={step} repo={repo} />
        ))}
      </ol>
    </div>
  );
}

function TouchedFiles({ files }: { files: string[] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <ul className={styles.files}>
      {files.map((file) => (
        <li key={file} className={styles.mono}>
          {file}
        </li>
      ))}
    </ul>
  );
}
