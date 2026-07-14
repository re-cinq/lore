"use client";

import type { DecompStoryGroup } from "@/lib/decomposition-view";

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--chart-neutral)",
  queued: "var(--chart-neutral)",
  running: "var(--chart-spec)",
  "pr-created": "var(--info)",
  review: "var(--info)",
  completed: "var(--success)",
  merged: "var(--success)",
  failed: "var(--danger)",
};

function TaskStatus({ status }: { status: string }) {
  return (
    <span
      className="meta"
      style={{
        display: "inline-block",
        minWidth: 72,
        textAlign: "center",
        marginRight: 8,
        padding: "0 6px",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--fs-xs)",
        color: "var(--text-on-accent)",
        background: STATUS_COLOR[status] ?? "var(--chart-neutral)",
      }}
    >
      {status}
    </span>
  );
}

/** The story/task tree a merged feature spec decomposed into (ADR-029). Hidden
 *  until the feature has been decomposed. */
export default function DecompositionView({
  owner,
  repo,
  stories,
  total,
}: {
  owner: string;
  repo: string;
  stories: DecompStoryGroup[];
  total: number;
}) {
  if (total === 0) {
    return null;
  }

  return (
    <div className="spec-card" style={{ marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>
        Decomposition{" "}
        <span className="meta">
          · {stories.length} stories · {total} tasks
        </span>
      </h3>
      {stories.map((s, i) => (
        <div key={s.storyIssue ?? `tasks-${i}`} style={{ marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 6px" }}>
            {s.storyIssue !== null ? (
              <a
                href={`https://github.com/${owner}/${repo}/issues/${s.storyIssue}`}
                target="_blank"
                rel="noreferrer"
              >
                User story #{s.storyIssue} ↗
              </a>
            ) : (
              "Tasks"
            )}
          </h4>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {s.tasks.map((t) => (
              <li
                key={t.specTaskId}
                style={{
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "baseline",
                }}
              >
                <TaskStatus status={t.status} />
                <span>{t.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
