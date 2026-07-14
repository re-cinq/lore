"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import type { IconName } from "@/components/icon-map";
import styles from "./Timeline.module.css";

interface TimelineCommit {
  sha: string;
  stage: string;
  iteration: number;
  outcome: string;
  committed_at: string;
  duration_ms: number | null;
  summary: string;
  extras?: Record<string, string>;
}

interface TimelineResponse {
  task_id: string;
  branch_name: string | null;
  repo: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "open" | "closed" | "merged" | null;
  commits: TimelineCommit[];
  current_stage: string | null;
  branch_deleted?: boolean;
  pending?: string;
  lease?: { held: boolean; holder?: string; expires_at?: string } | null;
}

const ACTIVE_STATES = new Set(["pending", "running", "queued", "review"]);
const POLL_INTERVAL_MS = 10_000;

const NODE_ICON: Record<string, IconName> = {
  draft: "draft",
  implement: "implement",
  validate: "validate",
  push: "push",
  review: "review",
  address: "address",
  retrospective: "retrospective",
  done: "done",
  gate: "gate",
};

const OUTCOME_COLOR: Record<string, string> = {
  success: "var(--success)",
  changes_requested: "var(--warning)",
  failed: "var(--danger)",
};

function formatDuration(ms: number | null): string {
  if (ms == null) {
    return "—";
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export default function Timeline({
  taskId,
  initialStatus,
}: {
  taskId: string;
  initialStatus: string;
}) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTimeline = useCallback(async () => {
    try {
      const r = await fetch(`/api/tasks/${taskId}/timeline`);

      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        setLoading(false);

        return;
      }
      const json = (await r.json()) as TimelineResponse;

      setData(json);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount; state is set inside the async fetch
    void fetchTimeline();
    const stillActive =
      ACTIVE_STATES.has(initialStatus) ||
      (data?.current_stage && data.current_stage !== "retrospective");

    if (!stillActive) {
      return;
    }
    const handle = setInterval(() => void fetchTimeline(), POLL_INTERVAL_MS);

    return () => clearInterval(handle);
  }, [fetchTimeline, initialStatus, data?.current_stage]);

  if (loading) {
    return (
      <div className={`spec-card ${styles.card}`}>
        <div className="meta">Loading timeline…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`spec-card ${styles.card}`}>
        <div className={styles.unavailable}>Timeline unavailable: {error}</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className={`spec-card ${styles.card}`}>
      <h3 className={styles.heading}>Stage Timeline</h3>

      {data.branch_deleted && (
        <div className={styles.deletedBanner}>
          Branch <code>{data.branch_name}</code> has been deleted on the remote.
          Showing last cached state.
        </div>
      )}

      {data.pending === "no_branch" && (
        <div className="meta">
          Task has no branch yet — waiting for the supervisor to acquire its
          lease and run the first stage.
        </div>
      )}

      {data.commits.length === 0 && !data.branch_deleted && (
        <div className="meta">No stage commits yet.</div>
      )}

      <ol className={styles.list}>
        {data.commits.map((c) => (
          <li key={c.sha} className={styles.item}>
            <div className={styles.iconCol}>
              <Icon name={NODE_ICON[c.stage] ?? "bullet"} size={18} />
            </div>
            <div className={styles.body}>
              <div className={styles.row}>
                <span className={styles.stage}>{c.stage}</span>
                <span className="meta">iter {c.iteration}</span>
                <span
                  className="status-pill"
                  style={{
                    ["--pill-color" as string]:
                      OUTCOME_COLOR[c.outcome] ?? "var(--text-muted)",
                  }}
                >
                  {c.outcome}
                </span>
                <span className="meta">{formatDuration(c.duration_ms)}</span>
              </div>
              <div className={styles.summary}>{c.summary}</div>
              {data.repo && (
                <a
                  href={`https://github.com/${data.repo}/commit/${c.sha}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`meta ${styles.commitLink}`}
                >
                  {c.sha.substring(0, 7)} <Icon name="external" size={11} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      {data.lease?.held && (
        <div className={`meta ${styles.lease}`}>
          <Icon name="lock" size={12} /> Lease held by{" "}
          <code>{data.lease.holder}</code>
          {data.lease.expires_at &&
            ` (expires ${new Date(data.lease.expires_at).toLocaleTimeString()})`}
        </div>
      )}
    </div>
  );
}
