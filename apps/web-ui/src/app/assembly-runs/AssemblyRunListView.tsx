import type { AssemblyRun } from "@/lib/assembly-runs";
import { runStatusVisual } from "@/lib/assembly-run-presenter";
import { connectionLabel } from "@/lib/run-stream-presenter";
import type { ChannelState } from "@/lib/live-socket/connection-machine";
import AssemblyRunsTable from "./AssemblyRunsTable";
import styles from "./AssemblyRunListView.module.css";

export interface AssemblyRunListViewProps {
  /** The active status filter, or undefined for "All". */
  activeStatus?: string;
  runs: AssemblyRun[];
  /** The keyset cursor this page was read at; absent on the first page. */
  cursor?: string;
  nextCursor?: string | null;
  /** The live channel's state; the chip shows only when given. */
  connection?: ChannelState;
}

const CONNECTION_BADGES: Record<ChannelState, string> = {
  live: "badge-green",
  connecting: "badge-gray",
  reconnecting: "badge-gray",
  offline: "badge-red",
};

/** The run status vocabulary — one status per run, so filtering is SQL-side. */
const FILTERS = ["queued", "running", "finished", "failed"] as const;

// Global assembly-runs list, keyed on per-attempt run records. Pure render — page.tsx fetches the status-filtered runs and passes them down.
export default function AssemblyRunListView({
  activeStatus,
  runs,
  cursor,
  nextCursor,
  connection,
}: AssemblyRunListViewProps) {
  return (
    <div>
      <RunListHeader connection={connection} />

      <StatusFilterBar activeStatus={activeStatus} />

      <AssemblyRunsTable runs={runs} showStages />

      <PageLinks
        activeStatus={activeStatus}
        cursor={cursor}
        nextCursor={nextCursor}
      />
    </div>
  );
}

function PageLinks({
  activeStatus,
  cursor,
  nextCursor,
}: Pick<AssemblyRunListViewProps, "activeStatus" | "cursor" | "nextCursor">) {
  return (
    <div className="filter-form">
      {cursor && <a href={runsHref({ status: activeStatus })}>Newest</a>}
      {nextCursor && (
        <a href={runsHref({ status: activeStatus, cursor: nextCursor })}>
          Older
        </a>
      )}
    </div>
  );
}

function runsHref(query: { status?: string; cursor?: string | null }): string {
  const params = new URLSearchParams();

  if (query.status) {
    params.set("status", query.status);
  }

  if (query.cursor) {
    params.set("cursor", query.cursor);
  }

  return params.size > 0 ? `/assembly-runs?${params}` : "/assembly-runs";
}

function StatusFilterBar({ activeStatus }: { activeStatus?: string }) {
  return (
    <div className="filter-form">
      <a href="/assembly-runs" className={!activeStatus ? "active" : ""}>
        All
      </a>
      {FILTERS.map((s) => (
        <a
          key={s}
          href={`/assembly-runs?status=${s}`}
          className={activeStatus === s ? "active" : ""}
        >
          {runStatusVisual(s, null).label}
        </a>
      ))}
    </div>
  );
}

function RunListHeader({ connection }: { connection?: ChannelState }) {
  return (
    <div className={styles.header}>
      <h1>Assembly Runs</h1>
      {connection && <ConnectionChip state={connection} />}
    </div>
  );
}

function ConnectionChip({ state }: { state: ChannelState }) {
  return (
    <span
      data-testid="runs-connection"
      className={`badge ${CONNECTION_BADGES[state]}`}
      role="status"
    >
      {connectionLabel(state)}
    </span>
  );
}
