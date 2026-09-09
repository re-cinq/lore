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

interface StoryTitleProps {
  issue: number | null;
  owner: string;
  repo: string;
}

/** The story's heading. A group with no Issue is headed "Tasks" rather than left unlabelled — those are the tasks the decomposition produced without a story to hang them on, which is a real state and not a gap. */
function StoryTitle(props: StoryTitleProps) {
  const { issue, owner, repo } = props;

  return (
    <h4 className={styles.storyTitle}>
      {issue !== null ? (
        <a
          href={`https://github.com/${owner}/${repo}/issues/${issue}`}
          target="_blank"
          rel="noreferrer"
        >
          User story #{issue} ↗
        </a>
      ) : (
        "Tasks"
      )}
    </h4>
  );
}

interface StoryGroupProps {
  story: DecompStoryGroup;
  owner: string;
  repo: string;
}

/** One user story and the tasks decomposed from it. A group with no Issue is headed "Tasks" rather than left unlabelled — those are the tasks the decomposition produced without a story to hang them on, which is a real state, not a gap. */
function StoryGroup(props: StoryGroupProps) {
  const { story, owner, repo } = props;

  return (
    <div className={styles.story}>
      <StoryTitle issue={story.storyIssue} owner={owner} repo={repo} />
      <ul className={styles.taskList}>
        {story.tasks.map((task) => (
          <li key={task.specTaskId} className={styles.taskItem}>
            <TaskStatus status={task.status} />
            <span>{task.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecompCounts({ stories, tasks }: { stories: number; tasks: number }) {
  return (
    <span className="meta">
      · {stories} stories · {tasks} tasks
    </span>
  );
}

interface DecompositionViewProps {
  owner: string;
  repo: string;
  stories: DecompStoryGroup[];
  total: number;
}

/** Every story group in order. The index keys the storyless group, which has no Issue number to key on. */
function StoryList(props: Omit<DecompositionViewProps, "total">) {
  const { stories, owner, repo } = props;

  return (
    <>
      {stories.map((story, index) => (
        <StoryGroup
          key={story.storyIssue ?? `tasks-${index}`}
          story={story}
          owner={owner}
          repo={repo}
        />
      ))}
    </>
  );
}

/** Story/task tree from merged feature spec decomposition (ADR-029), hidden until complete. */
export default function DecompositionView(props: DecompositionViewProps) {
  const { owner, repo, stories, total } = props;

  if (total === 0) {
    return null;
  }

  return (
    <div className="spec-card">
      <h3>
        Decomposition <DecompCounts stories={stories.length} tasks={total} />
      </h3>
      <StoryList stories={stories} owner={owner} repo={repo} />
    </div>
  );
}
