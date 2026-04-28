"use client";

import { useCallback, useEffect, useState } from "react";

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

const NODE_ICON: Record<string, string> = {
  draft: "✏️",
  implement: "🔧",
  validate: "✅",
  push: "⬆️",
  review: "🔍",
  address: "🛠️",
  retrospective: "📝",
  done: "🏁",
  gate: "🚧",
};

const OUTCOME_COLOR: Record<string, string> = {
  success: "#3fb950",
  changes_requested: "#d29922",
  failed: "#f85149",
};

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
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
      const r = await fetch(`/api/pipeline/${taskId}/timeline`);
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
    fetchTimeline();
    const stillActive =
      ACTIVE_STATES.has(initialStatus) ||
      (data?.current_stage && data.current_stage !== "retrospective");
    if (!stillActive) return;
    const handle = setInterval(fetchTimeline, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [fetchTimeline, initialStatus, data?.current_stage]);

  if (loading) {
    return (
      <div className="spec-card" style={{ marginTop: "16px" }}>
        <div className="meta">Loading timeline…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="spec-card" style={{ marginTop: "16px" }}>
        <div style={{ color: "#f85149" }}>Timeline unavailable: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="spec-card" style={{ marginTop: "16px" }}>
      <h3 style={{ margin: 0, marginBottom: "12px" }}>Stage Timeline</h3>

      {data.branch_deleted && (
        <div
          style={{
            padding: "8px 12px",
            background: "#3a2222",
            border: "1px solid #6b3636",
            borderRadius: "6px",
            color: "#f85149",
            marginBottom: "12px",
          }}
        >
          Branch <code>{data.branch_name}</code> has been deleted on the
          remote. Showing last cached state.
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

      <ol style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
        {data.commits.map((c) => (
          <li
            key={c.sha}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid #21262d",
              display: "flex",
              gap: "12px",
              alignItems: "flex-start",
            }}
          >
            <div style={{ fontSize: "20px", lineHeight: "1.4", width: "28px" }}>
              {NODE_ICON[c.stage] ?? "•"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 600 }}>{c.stage}</span>
                <span className="meta">iter {c.iteration}</span>
                <span
                  style={{
                    background: OUTCOME_COLOR[c.outcome] ?? "#6e7681",
                    color: "white",
                    fontSize: "11px",
                    padding: "1px 8px",
                    borderRadius: "10px",
                  }}
                >
                  {c.outcome}
                </span>
                <span className="meta">
                  {formatDuration(c.duration_ms)}
                </span>
              </div>
              <div style={{ marginTop: "4px", fontSize: "13px" }}>
                {c.summary}
              </div>
              {data.repo && (
                <a
                  href={`https://github.com/${data.repo}/commit/${c.sha}`}
                  target="_blank"
                  rel="noreferrer"
                  className="meta"
                  style={{ fontFamily: "monospace", fontSize: "11px" }}
                >
                  {c.sha.substring(0, 7)} ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      {data.lease?.held && (
        <div
          className="meta"
          style={{ marginTop: "12px", fontSize: "12px" }}
        >
          🔒 Lease held by <code>{data.lease.holder}</code>
          {data.lease.expires_at &&
            ` (expires ${new Date(data.lease.expires_at).toLocaleTimeString()})`}
        </div>
      )}
    </div>
  );
}
