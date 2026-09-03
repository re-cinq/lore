"use client";

import styles from "./DecompositionView.module.scss";
import type { DecompStoryGroup } from "@/lib/decomposition-view";

function TaskStatus({ status }: { status: string }) {
  return (
    <span className={`meta ${styles.status}`} data-status={status}>
      {status}
    </span>
  );
}

/** Story/task tree from merged feature spec decomposition (ADR-029), hidden until complete. */
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
    <div className="spec-card">
      <h3>
        Decomposition{" "}
        <span className="meta">
          · {stories.length} stories · {total} tasks
        </span>
      </h3>
      {stories.map((s, i) => (
        <div key={s.storyIssue ?? `tasks-${i}`} className={styles.story}>
          <h4 className={styles.storyTitle}>
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
          <ul className={styles.taskList}>
            {s.tasks.map((t) => (
              <li key={t.specTaskId} className={styles.taskItem}>
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
