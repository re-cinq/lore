import Link from "next/link";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { runStatusVisual } from "@/lib/assembly-run-presenter";
import AssemblyRunsTable from "./AssemblyRunsTable";
import styles from "./AssemblyRunListView.module.css";

export interface AssemblyRunListViewProps {
  /** The active status filter, or undefined for "All". */
  activeStatus?: string;
  runs: AssemblyRun[];
}

/** The run status vocabulary — one status per run, so filtering is SQL-side. */
const FILTERS = ["queued", "running", "finished", "failed"] as const;

// Global assembly-runs list, keyed on per-attempt run records. Pure render — page.tsx fetches the status-filtered runs and passes them down.
export default function AssemblyRunListView({
  activeStatus,
  runs,
}: AssemblyRunListViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <h1>Assembly Runs</h1>
        <Link href="/assembly-runs/create">
          <button>+ Create Task</button>
        </Link>
      </div>

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

      <AssemblyRunsTable runs={runs} />
    </div>
  );
}
