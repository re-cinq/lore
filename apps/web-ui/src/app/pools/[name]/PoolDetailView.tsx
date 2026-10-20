import Link from "next/link";
import { PoolValueCell } from "./PoolValueCell";
import { TimeAgo } from "@/components/TimeAgo";
import { displayAgentId } from "@/lib/agent-id";
import styles from "./PoolDetailView.module.css";
import type { components } from "@/lib/api/schema";

export type PoolEntryRow =
  components["schemas"]["SharedPoolDetail"]["entries"][number];

export interface PoolDetailViewProps {
  poolName: string;
  found: boolean;
  createdBy: string;
  createdAt: string;
  entries: PoolEntryRow[];
}

export default function PoolDetailView(props: PoolDetailViewProps) {
  const { poolName, found, createdBy, createdAt, entries } = props;

  if (!found) {
    return <PoolNotFound poolName={poolName} />;
  }

  return (
    <div>
      <PoolCrumb poolName={poolName} />
      <h1 className={styles.title}>{poolName}</h1>
      <PoolSummary
        createdBy={createdBy}
        createdAt={createdAt}
        entries={entries}
      />
      <PoolEntries entries={entries} />
    </div>
  );
}

function PoolCrumb({ poolName }: { poolName: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`breadcrumb ${styles.crumb}`}>
      <Link href="/pools">Pools</Link> <span aria-hidden="true">/</span>{" "}
      <span className={styles.crumbName}>{poolName}</span>
    </nav>
  );
}

/** A pool name in the URL that no pool matches — a deleted pool, or a typo. */
function PoolNotFound({ poolName }: { poolName: string }) {
  return (
    <div>
      <PoolCrumb poolName={poolName} />
      <h1>Pool Not Found</h1>
      <div className="empty-state">
        <p>No pool named &quot;{poolName}&quot; exists.</p>
      </div>
    </div>
  );
}

interface PoolSummaryProps {
  createdBy: string;
  createdAt: string;
  entries: PoolEntryRow[];
}

/** Who made the pool, when, and how much is in it from how many agents. */
function PoolSummary({ createdBy, createdAt, entries }: PoolSummaryProps) {
  return (
    <p className={styles.summary}>
      Created by {displayAgentId(createdBy)} on{" "}
      <TimeAgo date={createdAt} inline /> · {entryCountText(entries)}
    </p>
  );
}

/** "3 entries from 2 agents"; the agents are counted from the entries shown. */
function entryCountText(entries: PoolEntryRow[]): string {
  const count = entries.length;
  const agents = new Set(entries.map((e) => e.agent_id)).size;
  const text = `${count} entr${count === 1 ? "y" : "ies"}`;

  return agents === 0
    ? text
    : `${text} from ${agents} agent${agents === 1 ? "" : "s"}`;
}

function PoolEntries({ entries }: Pick<PoolDetailViewProps, "entries">) {
  if (entries.length === 0) {
    return <p className={styles.empty}>No entries in this pool</p>;
  }

  return (
    <ul className={styles.list} aria-label="Pool entries">
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

/** One entry, at the version currently in the pool. The agent's full id is in the title attribute; the card shows the shortened form so the line stays readable. */
function EntryCard({ entry }: { entry: PoolEntryRow }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <strong className={styles.key}>{entry.key}</strong>
        <span className={styles.meta}>
          <span className={styles.version}>v{entry.version}</span>
          <span title={entry.agent_id}>{displayAgentId(entry.agent_id)}</span>
          <TimeAgo date={entry.created_at} inline />
        </span>
      </div>
      <PoolValueCell value={entry.value} />
    </li>
  );
}
