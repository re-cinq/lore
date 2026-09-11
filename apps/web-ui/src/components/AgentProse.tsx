import { memo } from "react";
import Markdown from "./Markdown";
import {
  splitNodeResult,
  type NodeOutcome,
  type NodeResultLine,
} from "@/lib/node-result-line";
import styles from "./AgentProse.module.css";

type Tone = NodeOutcome | "unparseable";

const TONE_CLASS: Record<Tone, string> = {
  success: styles.success,
  changes_requested: styles.changesRequested,
  failed: styles.failed,
  unparseable: styles.failed,
};

/** What an agent wrote, rendered as markdown, with its LORE_NODE_RESULT verdict lifted out into a card the reader cannot miss. Memoized: the live stream re-renders the whole transcript per event, and re-parsing thousands of unchanged turns' markdown each time would stall it. */
const AgentProse = memo(function AgentProse({ text }: { text: string }) {
  const { prose, nodeResult } = splitNodeResult(text);

  return (
    <div className={styles.agentProse}>
      {prose && <Markdown markdown={prose} className={styles.markdown} />}
      {nodeResult && <NodeResultCard result={nodeResult} />}
    </div>
  );
});

export default AgentProse;

function NodeResultCard({ result }: { result: NodeResultLine }) {
  const tone: Tone = result.valid ? result.outcome : "unparseable";

  return (
    <section
      className={`${styles.card} ${TONE_CLASS[tone]}`}
      data-node-result={tone}
      aria-label="Node result"
    >
      <header className={styles.cardHeader}>
        <span className={styles.cardTitle}>Node result</span>
        <span className={styles.badge}>{tone}</span>
      </header>
      {result.valid ? (
        <NodeResultExtras extras={result.extras} />
      ) : (
        <code className={styles.payload}>{result.payload}</code>
      )}
    </section>
  );
}

function NodeResultExtras({ extras }: { extras: Record<string, string> }) {
  const entries = Object.entries(extras);

  if (entries.length === 0) {
    return null;
  }

  return (
    <dl className={styles.extras}>
      {entries.map(([key, value]) => (
        <div key={key} className={styles.extra}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
