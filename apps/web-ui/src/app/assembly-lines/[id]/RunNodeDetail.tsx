// The detail card for the selected graph node: the plain-language "why" plus the
// supporting facts and links. Pure render over the presenter's output.

import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyLineRunNode } from "@/lib/assembly-line-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";
import { formatRelativeTime } from "@/lib/assembly-line-presenter";
import { describeNode, type NodeDetail } from "@/lib/run-node-detail-presenter";
import type { NodeStatusTone } from "@/lib/run-node-status";
import styles from "./RunNodeDetail.module.css";

const PILL_CLASS: Record<NodeStatusTone, string> = {
  ok: styles.pillOk,
  warn: styles.pillWarn,
  err: styles.pillErr,
  running: styles.pillRunning,
  idle: styles.pillIdle,
};

const WHY_CLASS: Record<NodeStatusTone, string> = {
  ok: styles.whyOk,
  warn: styles.whyWarn,
  err: styles.whyErr,
  running: styles.whyRunning,
  idle: styles.whyIdle,
};

export interface RunNodeDetailProps {
  nodeId: string;
  state: NodeRunState | undefined;
  row: AssemblyLineRunNode | undefined;
  definition: AssemblyLineDefinition | null;
  reason: string | null;
  repo: string;
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
    <section className={styles.card} aria-label={`${props.nodeId} detail`}>
      <div className={styles.head}>
        <span className={styles.name}>{props.nodeId}</span>
        <span className={`${styles.pill} ${PILL_CLASS[detail.tone]}`}>
          {detail.statusLabel}
        </span>
        {detail.nodeType ? (
          <span className={styles.meta}>{detail.nodeType}</span>
        ) : null}
      </div>

      <p className={`${styles.why} ${WHY_CLASS[detail.tone]}`}>{detail.why}</p>

      {detail.failures.length > 0 ? (
        <div className={styles.failures}>
          <div className={styles.failuresHead}>
            Errored steps ({detail.failures.length})
          </div>
          <ul className={styles.failList}>
            {detail.failures.map((step, i) => (
              <li key={i} className={styles.failItem}>
                <span className={styles.failTool}>{step.tool}</span>
                <span className={styles.failDetail}>{step.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className={styles.facts}>
        <Fact label="Attempt">{detail.iteration || "—"}</Fact>
        <Fact label="Duration">{detail.durationLabel}</Fact>
        <Fact label="Started">
          {detail.startedAt ? (
            <time dateTime={detail.startedAt} title={detail.startedAt}>
              {formatRelativeTime(detail.startedAt)}
            </time>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label="Outcome">{detail.outcomeLabel}</Fact>
        <Fact label="Files touched">{detail.files.length || "—"}</Fact>
        <Fact label="Transcript">
          {detail.eventCount} event{detail.eventCount === 1 ? "" : "s"}
          {detail.droppedCount > 0 ? ` (+${detail.droppedCount} dropped)` : ""}
        </Fact>
        {detail.agentCrName ? (
          <Fact label="Agent CR">
            <span className={styles.mono}>{detail.agentCrName}</span>
          </Fact>
        ) : null}
        {detail.commitSha ? (
          <Fact label="Commit">
            <a
              className={styles.mono}
              href={`https://github.com/${props.repo}/commit/${detail.commitSha}`}
              target="_blank"
              rel="noreferrer"
            >
              {detail.commitSha.substring(0, 7)}
            </a>
          </Fact>
        ) : null}
      </dl>

      {detail.files.length > 0 ? (
        <ul className={styles.files}>
          {detail.files.map((file) => (
            <li key={file} className={styles.mono}>
              {file}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
