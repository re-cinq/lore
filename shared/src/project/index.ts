/**
 * The unified Project facade — pure surface only. Adapters (octokit, pg, git,
 * exec) are reached by deep import so this barrel stays importable from light
 * runtimes (web-ui) without pulling heavy deps.
 */

export { Project } from "./lib/project.js";
export { createProject, setProject, project } from "./lib/project-factory.js";
export { executionRefusal, assertCanClone } from "./lib/trust.js";

export type { GitHubPort, IssueRef, IssueFilter, IssueState } from "./lib/github-port.js";
export { IssueCollection } from "./issues/issues.js";
export { RepoFiles } from "./repo/repo-files.js";

export type {
  PullRequestsPort,
  PullRef,
  PRReviewEvent,
  MergeMethod,
} from "./pulls/pull-requests-port.js";
export { PullRequests } from "./pulls/pull-requests.js";

export type { SettingsPort } from "./settings/settings-port.js";
export { Settings } from "./settings/settings.js";

export type { MemoryPort, MemoryRecord, MemoryWriteResult } from "./memory/memory-port.js";
export { Memory } from "./memory/memory.js";

export type {
  TaskStorePort,
  TaskAction,
  TaskTransitionMeta,
} from "./tasks/task-store-port.js";
export { TaskList } from "./tasks/task-list.js";
export { Task } from "./tasks/task.js";

export type { NotifyPort, NotifyLevel, NotifyResult } from "./notify/notify-port.js";
export { Notify } from "./notify/notify.js";

export type {
  KnowledgePort,
  AssembledContext,
  GraphEdge,
  DocRef,
} from "./knowledge/knowledge-port.js";
export { KnowledgeView } from "./knowledge/knowledge.js";

export type { TestRunnerPort, TestRunReport } from "./test-runner/test-runner-port.js";
export { TestSuite } from "./test-runner/test-suite.js";

export type {
  AgentRunnerPort,
  AgentMode,
  AgentRunResult,
  AgentRunOpts,
} from "./agents/agent-runner-port.js";
export { Agents } from "./agents/agents.js";

export type { GitPort, CloneOpts } from "./workspace/git-port.js";
export { Workspace } from "./workspace/workspace.js";
