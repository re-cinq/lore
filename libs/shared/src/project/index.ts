/**
 * The unified Project facade — pure surface only. Adapters (octokit, pg, git,
 * exec) are reached by deep import so this barrel stays importable from light
 * runtimes (web-ui) without pulling heavy deps.
 */

export { Project } from "./lib/project.js";
export { createProject, setProject, project } from "./lib/project-factory.js";
export {
  createStationProject,
  type StationProjectEnv,
} from "./lib/station-http.js";
export type {
  ChunksPort,
  ChunkInsert,
  SpecChunkRow,
  CodeSymbolRow,
  SpecChunkWithIngest,
  TestChunkRange,
  SpecChunkWithEmbedding,
  CodeChunkFull,
} from "./chunks/chunks-port.js";
export { executionRefusal, assertCanClone } from "./lib/trust.js";

export type {
  GitHubPort,
  IssueRef,
  IssueFilter,
  IssueState,
} from "./lib/github-port.js";
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

export type {
  MemoryPort,
  MemoryRecord,
  MemoryWriteResult,
} from "./memory/memory-port.js";
export { Memory } from "./memory/memory.js";

export type {
  TaskStorePort,
  TaskAction,
  TaskTransitionMeta,
} from "./tasks/task-store-port.js";
export { TaskList } from "./tasks/task-list.js";
export { Task } from "./tasks/task.js";

export type {
  AssemblyLinesPort,
  AssemblyLineStartInput,
  AssemblyLineNodeStartInput,
  AssemblyLineRecord,
} from "./assembly-lines/assembly-lines-port.js";
export { AssemblyLines } from "./assembly-lines/assembly-lines.js";

export type {
  AgentRunEventsRepository,
  AgentRunEventRow,
  AgentRunEventInsert,
  AgentRunEventNodeRef,
  AgentRunEventType,
} from "./agent-run-events/agent-run-events-port.js";

export type {
  NotifyPort,
  NotifyLevel,
  NotifyResult,
} from "./notify/notify-port.js";
export { Notify } from "./notify/notify.js";
export { decideNotify, type NotifySettings } from "./notify/notify-decision.js";

export type {
  KnowledgePort,
  AssembledContext,
  DocRef,
} from "./knowledge/knowledge-port.js";
export { KnowledgeView } from "./knowledge/knowledge.js";
export {
  queryLiveGraph,
  type LiveGraphResult,
} from "./knowledge/live-graph.js";

export type {
  TestRunnerPort,
  TestRunReport,
} from "./test-runner/test-runner-port.js";
export { TestSuite } from "./test-runner/test-suite.js";

export type {
  AgentRunnerPort,
  AgentMode,
  AgentRunResult,
  AgentRunOpts,
} from "./agents/agent-runner-port.js";
export { Agents } from "./agents/agents.js";
export { AgentDefs } from "./agents/agent-defs.js";
export type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefsPort,
} from "./agents/agent-defs-port.js";
export { resolveAgentConfig, KNOWN_MODELS } from "./agents/agent-defs-port.js";
export type { LlmPort, LlmCompletion } from "./agents/llm-port.js";
export type { K8sPort, LoreTaskSpec } from "./agents/k8s-port.js";
export type {
  StationBackend,
  StationLaunchResult,
  StationCompletion,
  StationBackendKind,
} from "./agents/station-port.js";
export {
  selectStationBackend,
  defaultStationName,
} from "./agents/station-port.js";
export { stationPlainEnv } from "./agents/station-env.js";
export type {
  StationCredentials,
  StationLlmCredential,
  StationMount,
} from "./agents/station-credentials.js";
export type { ProjectProviders } from "./lib/providers.js";

export type { GitPort, CloneOpts } from "./workspace/git-port.js";
export { Workspace } from "./workspace/workspace.js";
