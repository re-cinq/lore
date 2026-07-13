import Link from "next/link";
import PRStatusBadge from "./PRStatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { formatCost } from "@/lib/task-presenter";
import { formatEnumLabel } from "@/lib/enum-label";
import styles from "./AssemblyLineTable.module.css";
import {
  type AssemblyLine,
  type AssemblyLineTaskRow,
  deriveAssemblyLineStatus,
  statusVisual,
  formatDuration,
  formatRelativeTime,
} from "@/lib/assembly-lines";

export interface AssemblyLineTableProps {
  runs: AssemblyLine[];
  /** Show a per-run cost column (sum of member task costs). */
  showCost?: boolean;
  /** Empty-state CTA target — the per-repo tab points this at its own create page. */
  createHref?: string;
  /** A status filter is active — an empty result means "no matches", not "no runs yet". */
  filtered?: boolean;
}

/**
 * GitLab-pipelines-style table of assembly-line runs. Each row is one run (a
 * chain of related tasks producing one PR); the Stages cell is a mini-graph of
 * the chain's member tasks, each a server-rendered <details> dropdown. Shared by
 * the global list and the per-repo tab — pure render, no IO.
 */
export default function AssemblyLineTable({
  runs,
  showCost = false,
  createHref = "/assembly-lines/create",
  filtered = false,
}: AssemblyLineTableProps) {
  const columns = showCost ? 6 : 5;
  const emptyState = filtered ? (
    <EmptyState
      title="No matches for this filter"
      description="No runs have this status."
      action={{ href: "/assembly-lines", label: "Clear filter" }}
    />
  ) : (
    <EmptyState
      title="No assembly lines yet"
      description="Runs appear when a task is claimed — create a task to start one."
      action={{ href: createHref, label: "Create a task" }}
    />
  );
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Status</th>
          <th>Assembly Line</th>
          <th>Created by</th>
          {showCost && <th>Cost</th>}
          <th>Stages</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <AssemblyLineRow key={run.runKey} run={run} showCost={showCost} />
        ))}
        {runs.length === 0 && (
          <tr>
            <td colSpan={columns}>{emptyState}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function AssemblyLineRow({
  run,
  showCost,
}: {
  run: AssemblyLine;
  showCost: boolean;
}) {
  const visual = statusVisual(run.status);
  return (
    <tr>
      <td>
        <span className={styles.ciIcon}>
          <span className={`${styles.dot} ${styles[visual.tone]}`} />
          {visual.label}
        </span>
        <div className={styles.statusMeta}>
          <span>{formatDuration(run.startedAt, run.updatedAt)}</span>
          <span>{formatRelativeTime(run.updatedAt)}</span>
        </div>
      </td>

      <td>
        <Link
          href={`/assembly-lines/${run.lead.id}`}
          className={styles.runTitle}
        >
          {run.lead.description}
        </Link>
        <div className={styles.metaRow}>
          <Link
            href={`/assembly-lines/${run.lead.id}`}
            className={styles.runId}
          >
            #{run.lead.id.substring(0, 8)}
          </Link>
          {run.targetRepo && (
            <Link
              href={`/repos/${run.targetRepo}`}
              className={styles.metaBadge}
            >
              {run.targetRepo}
            </Link>
          )}
          {run.lead.target_branch && (
            <span className={styles.metaBadge}>{run.lead.target_branch}</span>
          )}
          {run.prUrl && (
            <span className={styles.prCell}>
              <a href={run.prUrl} target="_blank" className={styles.metaBadge}>
                {run.prNumber ? `#${run.prNumber}` : "PR"}
              </a>
              {run.prNumber && <PRStatusBadge taskId={run.lead.id} />}
            </span>
          )}
        </div>
      </td>

      <td>
        <span className={styles.avatar} title={run.lead.created_by}>
          {initials(run.lead.created_by)}
        </span>
      </td>

      {showCost && <td>{formatCost(runCost(run))}</td>}

      <td>
        <div className={styles.miniGraph} data-testid="al-mini-graph">
          {run.members.map((m) => (
            <StageDot key={m.id} member={m} />
          ))}
        </div>
      </td>

      <td>
        <div className={styles.actions}>
          {run.lead.status === "pending" && (
            <form
              action={`/api/assembly-lines/${run.lead.id}/run-now`}
              method="POST"
              className={styles.runNowForm}
            >
              <button type="submit" className={styles.runNowBtn}>
                Run Now
              </button>
            </form>
          )}
          {run.prUrl && (
            <a href={run.prUrl} target="_blank" className={styles.actionLink}>
              Open PR
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

function StageDot({ member }: { member: AssemblyLineTaskRow }) {
  const tone = statusVisual(deriveAssemblyLineStatus([member])).tone;
  return (
    <details className={styles.stage} data-testid="al-stage">
      <summary
        className={styles.stageSummary}
        title={`${member.task_type}: ${member.status}`}
      >
        <span
          className={`${styles.stageDot} ${styles[tone]}`}
          aria-label={`${member.task_type}: ${member.status}`}
        />
      </summary>
      <div className={styles.stagePanel}>
        <div className={styles.stagePanelHead}>{member.task_type}</div>
        <Link
          href={`/assembly-lines/${member.id}`}
          className={styles.stageLink}
        >
          <span className={`op-badge op-${member.status}`}>
            {formatEnumLabel(member.status)}
          </span>
          <span className={styles.stageDesc}>{member.description}</span>
        </Link>
      </div>
    </details>
  );
}

function runCost(run: AssemblyLine): number {
  return run.members.reduce((sum, m) => sum + (m.cost_usd ?? 0), 0);
}

function initials(createdBy: string): string {
  return (createdBy.trim().slice(0, 2) || "—").toUpperCase();
}
