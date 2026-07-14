import Link from "next/link";
import AssemblyLineTable from "./AssemblyLineTable";
import styles from "./AssemblyLineListView.module.css";
import {
  type AssemblyLine,
  type AssemblyLineStatus,
  statusVisual,
} from "@/lib/assembly-lines";

export interface AssemblyLineListViewProps {
  /** The active status filter, or undefined for "All". */
  activeStatus?: string;
  runs: AssemblyLine[];
}

const FILTERS: AssemblyLineStatus[] = [
  "running",
  "pr-created",
  "review",
  "merged",
  "failed",
  "needs-human",
  "pending",
];

/**
 * Global assembly-lines list — GitLab-pipelines-style. Pure render: the
 * container (`page.tsx`) groups the rows and passes the runs down; the table
 * itself is the shared <AssemblyLineTable>.
 */
export default function AssemblyLineListView({
  activeStatus,
  runs,
}: AssemblyLineListViewProps) {
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
            {statusVisual(s).label}
          </a>
        ))}
      </div>

      <AssemblyLineTable runs={runs} filtered={!!activeStatus} />
    </div>
  );
}
