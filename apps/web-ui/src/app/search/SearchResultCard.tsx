import { displayAgentId } from "@/lib/agent-id";
import { formatEnumLabel } from "@/lib/enum-label";
import type { SearchResult } from "./SearchView";
import { Meter } from "@/components/insights/Meter";
import styles from "./SearchResultCard.module.css";

interface SearchResultCardProps {
  result: SearchResult;
  /** The page's top score, which a full score bar stands for. */
  best: number;
}

/** One hit: its source and key, how it scored, the text itself and where it came from. */
export default function SearchResultCard({
  result: r,
  best,
}: SearchResultCardProps) {
  return (
    <article className={styles.card} aria-label={r.key}>
      <div className={styles.head}>
        <span className={styles.title}>
          <span className={`${styles.source} ${styles[r.source]}`}>
            {formatEnumLabel(r.source)}
          </span>
          <span className={styles.key}>{r.key}</span>
        </span>
        <ScoreMeter score={r.score} best={best} />
      </div>
      <pre className={styles.value}>{r.value}</pre>
      <ResultMeta repo={r.repo} agentId={r.agent_id} />
    </article>
  );
}

/** Where the hit came from: its repository, when it has one, and the agent that wrote it. */
function ResultMeta(props: {
  repo: SearchResult["repo"];
  agentId: SearchResult["agent_id"];
}) {
  return (
    <div className={styles.meta}>
      {props.repo && <span className={styles.repo}>{props.repo}</span>}
      <span>agent {displayAgentId(props.agentId)}</span>
    </div>
  );
}

/** The score as a number and as a bar relative to the best hit; ranked scores are only comparable within one search. */
function ScoreMeter({ score, best }: { score: number; best: number }) {
  return (
    <span className={styles.score}>
      <Meter fraction={best > 0 ? score / best : 0} />
      score {score.toFixed(3)}
    </span>
  );
}
