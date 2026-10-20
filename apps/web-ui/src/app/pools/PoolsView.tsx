import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { EmptyState } from "@/components/EmptyState";
import ScreenHeader from "@/components/ScreenHeader";
import { displayAgentId } from "@/lib/agent-id";
import styles from "./PoolsView.module.css";
import type { components } from "@/lib/api/schema";

/** One shared pool with its counts — the counts are aggregates, not columns. */
export type PoolRow = components["schemas"]["SharedPoolList"]["pools"][number];

const LEDE =
  "Namespaces where several agents contribute shared facts. Agents create them through the shared-memory MCP tools.";

export interface PoolsViewProps {
  pools: PoolRow[];
}

export default function PoolsView({ pools }: PoolsViewProps) {
  return (
    <div>
      <ScreenHeader group="knowledge" title="Shared memory pools" lede={LEDE} />
      {pools.length === 0 ? (
        <EmptyPools />
      ) : (
        <ul className={styles.grid}>
          {pools.map((pool) => (
            <PoolCard key={pool.id} pool={pool} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One pool, the whole card clickable through its name's link. */
function PoolCard({ pool }: { pool: PoolRow }) {
  return (
    <li className={styles.card}>
      <h2 className={styles.name}>
        <Link
          href={`/pools/${encodeURIComponent(pool.name)}`}
          className={styles.link}
        >
          {pool.name}
        </Link>
      </h2>
      <dl className={styles.figures}>
        <Figure label="Entries" value={pool.entry_count} />
        <Figure label="Contributing agents" value={pool.agent_count} />
      </dl>
      <PoolOrigin pool={pool} />
    </li>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.figure}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Who made the pool and when. The creator's full agent id lives in the title attribute — the displayed form is shortened to stay readable, and the full id is what someone needs when tracking a pool back to its agent. */
function PoolOrigin({ pool }: { pool: PoolRow }) {
  return (
    <p className={styles.origin}>
      Created by{" "}
      <span title={pool.created_by}>{displayAgentId(pool.created_by)}</span> ·{" "}
      <TimeAgo date={pool.created_at} inline />
    </p>
  );
}

/** Nothing to show, and nothing for the reader to do about it: pools are created by agents through the MCP tools, not from this page. */
function EmptyPools() {
  return (
    <div className={styles.empty}>
      <EmptyState
        title="No shared pools yet"
        description="Pools are created programmatically by agents via the shared-memory MCP tools."
      />
    </div>
  );
}
