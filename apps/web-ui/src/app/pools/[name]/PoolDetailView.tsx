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

export default function PoolDetailView({
  poolName,
  found,
  createdBy,
  createdAt,
  entries,
}: PoolDetailViewProps) {
  if (!found) {
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

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/pools">Pools</Link> / <strong>{poolName}</strong>
      </div>
      <h1>{poolName}</h1>
      <p className={`meta ${styles.summary}`}>
        Created by {displayAgentId(createdBy)} on{" "}
        <TimeAgo date={createdAt} inline /> · {entries.length} entr
        {entries.length !== 1 ? "ies" : "y"}
      </p>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Agent</th>
            <th>Version</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <strong>{e.key}</strong>
              </td>
              <PoolValueCell value={e.value} />
              <td title={e.agent_id}>{displayAgentId(e.agent_id)}</td>
              <td>v{e.version}</td>
              <td>
                <TimeAgo date={e.created_at} />
              </td>
            </tr>
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
    </div>
  );
}
