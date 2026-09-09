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

/** A pool name in the URL that no pool matches — a deleted pool, or a typo. */
function PoolNotFound({ poolName }: { poolName: string }) {
  return (
    <div>
      <div className="breadcrumb">
        <Link href="/pools">Pools</Link> / {poolName}
      </div>
      <h1>Pool Not Found</h1>
      <div className="empty-state">
        <p>No pool named &quot;{poolName}&quot; exists.</p>
      </div>
    </div>
  );
}

/** The entry columns. */
function EntriesHead() {
  return (
    <thead>
      <tr>
        <th>Key</th>
        <th>Value</th>
        <th>Agent</th>
        <th>Version</th>
        <th>Created</th>
      </tr>
    </thead>
  );
}

/** One entry, at the version currently in the pool. The agent's full id is in the title attribute; the cell shows the shortened form so the column stays readable. */
function EntryRow({
  entry,
}: {
  entry: PoolDetailViewProps["entries"][number];
}) {
  return (
    <tr>
      <td>
        <strong>{entry.key}</strong>
      </td>
      <PoolValueCell value={entry.value} />
      <td title={entry.agent_id}>{displayAgentId(entry.agent_id)}</td>
      <td>v{entry.version}</td>
      <td>
        <TimeAgo date={entry.created_at} />
      </td>
    </tr>
  );
}

interface PoolEntriesTableProps {
  entries: PoolDetailViewProps["entries"];
}

function PoolEntriesTable({ entries }: PoolEntriesTableProps) {
  return (
    <table>
      <EntriesHead />
      <tbody>
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
        {entries.length === 0 && (
          <tr>
            <td colSpan={5} className={styles.emptyCell}>
              No entries in this pool
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function PoolDetailView(props: PoolDetailViewProps) {
  const { poolName, found, createdBy, createdAt, entries } = props;

  if (!found) {
    return <PoolNotFound poolName={poolName} />;
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/pools">Pools</Link> / <strong>{poolName}</strong>
      </div>
      <h1>{poolName}</h1>
      <PoolSummary
        createdBy={createdBy}
        createdAt={createdAt}
        entryCount={entries.length}
      />
      <PoolEntriesTable entries={entries} />
    </div>
  );
}

interface PoolSummaryProps {
  createdBy: string;
  createdAt: string;
  entryCount: number;
}

function PoolSummary({ createdBy, createdAt, entryCount }: PoolSummaryProps) {
  return (
    <p className={`meta ${styles.summary}`}>
      Created by {displayAgentId(createdBy)} on{" "}
      <TimeAgo date={createdAt} inline /> · {entryCount} entr
      {entryCount !== 1 ? "ies" : "y"}
    </p>
  );
}
