// Detail card for the selected graph node: plain-language "why" plus supporting facts and links. Pure render over the presenter's output.
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";
import { formatRelativeTime } from "@/lib/assembly-run-presenter";
import { describeNode, type NodeDetail } from "@/lib/run-node-detail-presenter";
import type { NodeStatusTone } from "@/lib/run-node-status";
import type { StepView } from "@/lib/step-presenter";
import { modelShortLabel, type NodeModel } from "@/lib/node-models";
import CollapsibleCard from "@/components/CollapsibleCard";
import { AttemptHistory } from "./AttemptHistory";
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
  /** Header-row actions (run this station, edit agent), forwarded to the card's summary. */
  actions?: React.ReactNode;
  /** The model this node runs on, with where the answer came from; absent for a node that runs no recipe. */
  model?: NodeModel | null;
  /** The attempt the center column shows; its row in the history reads as pressed. */
  selectedIteration?: number;
  /** Called with an attempt's iteration when its row is clicked. */
  onPickAttempt?: (iteration: number) => void;
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
      <NodeFacts detail={detail} repo={props.repo} model={props.model} />
      <AttemptHistory {...props} />
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

interface NodeFactsProps {
  detail: NodeDetail;
  repo: string;
  model: NodeModel | null | undefined;
}

function NodeFacts({ detail, repo, model }: NodeFactsProps) {
  return (
    <dl className={styles.facts}>
      <ModelFact model={model} />
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

/** Which model the node runs on, and whether the catalog or the definition said so — a per-repo override changes the first without touching the second. */
function ModelFact({ model }: { model: NodeModel | null | undefined }) {
  if (!model) {
    return null;
  }

  return (
    <Fact label="Model">
      {modelShortLabel(model.model)}{" "}
      <span className={styles.attemptMeta}>({model.source})</span>
    </Fact>
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

interface CommitFactProps {
  commitSha: string | null;
  repo: string;
}

function CommitFact({ commitSha, repo }: CommitFactProps) {
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
