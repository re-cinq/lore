import { TimeAgo } from "@/components/TimeAgo";
import Icon from "@/components/Icon";
import { formatEnumLabel } from "@/lib/enum-label";
import { displayAgentId } from "@/lib/agent-id";
import type { AuditEntryRow } from "./AuditView";
import styles from "./AuditView.module.css";

/** One entry. With metadata it is a disclosure that opens onto the pretty-printed JSON; without, a plain row with nothing to open. */
export function AuditRow({ entry }: { entry: AuditEntryRow }) {
  return (
    <li className={styles.row}>
      {entry.metadata ? (
        <details>
          <summary className={styles.rowLine}>
            <RowCells entry={entry} />
            <Icon name="chevron" size={16} className={styles.chevron} />
          </summary>
          <MetadataJson metadata={entry.metadata} />
        </details>
      ) : (
        <div className={styles.rowLine}>
          <RowCells entry={entry} />
        </div>
      )}
    </li>
  );
}

function MetadataJson({ metadata }: { metadata: unknown }) {
  return (
    <pre className={styles.metadata}>{JSON.stringify(metadata, null, 2)}</pre>
  );
}

/** The agent's full id is in the title attribute: the displayed form is shortened, and the full id is what someone needs when tracing an operation back. */
function RowCells({ entry }: { entry: AuditEntryRow }) {
  return (
    <>
      <span className={styles.when}>
        <TimeAgo date={entry.created_at} />
      </span>
      <span className={`op-badge op-${entry.operation} ${styles.op}`}>
        {formatEnumLabel(entry.operation)}
      </span>
      <span className={styles.key}>{entry.memory_key || "—"}</span>
      <span className={styles.pool}>{entry.pool_name || "—"}</span>
      <span className={styles.agent} title={entry.agent_id}>
        {displayAgentId(entry.agent_id)}
      </span>
    </>
  );
}
