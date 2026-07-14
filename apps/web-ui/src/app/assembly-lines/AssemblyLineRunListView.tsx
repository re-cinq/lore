import Link from "next/link";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";
import { runStatusVisual } from "@/lib/assembly-line-presenter";
import AssemblyLineRunsTable from "./AssemblyLineRunsTable";
import styles from "./AssemblyLineRunListView.module.css";

export interface AssemblyLineRunListViewProps {
  /** The active status filter, or undefined for "All". */
  activeStatus?: string;
  runs: AssemblyLineRun[];
}

/** The run status vocabulary — one status per run, so filtering is SQL-side. */
const FILTERS = ["queued", "running", "finished", "failed"] as const;

/**
 * Global assembly-lines list, keyed on the per-attempt run records. Pure render:
 * the container (`page.tsx`) fetches the runs (already status-filtered) and
 * passes them down; the table is the shared <AssemblyLineRunsTable>.
 */
export default function AssemblyLineRunListView({
  activeStatus,
  runs,
}: AssemblyLineRunListViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <h1>Assembly Lines</h1>
        <Link href="/assembly-lines/create">
          <button>+ Create Task</button>
        </Link>
      </div>

      <div className="filter-form">
        <a href="/assembly-lines" className={!activeStatus ? "active" : ""}>
          All
        </a>
        {FILTERS.map((s) => (
          <a
            key={s}
            href={`/assembly-lines?status=${s}`}
            className={activeStatus === s ? "active" : ""}
          >
            {runStatusVisual(s, null).label}
          </a>
        ))}
      </div>

      <AssemblyLineRunsTable runs={runs} />
    </div>
  );
}
