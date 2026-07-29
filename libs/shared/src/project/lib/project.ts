import { enforceTrue } from "../../lib/enforce.js";
import { ChunkStore } from "../chunks/chunks.js";
import { IssueCollection } from "../issues/issues.js";
import { RepoFiles } from "../repo/repo-files.js";
import { PullRequests } from "../pulls/pull-requests.js";
import { Settings } from "../settings/settings.js";
import { Memory } from "../memory/memory.js";
import { TaskList } from "../tasks/task-list.js";
import { AssemblyLines } from "../assembly-lines/assembly-lines.js";
import { Notify } from "../notify/notify.js";
import { KnowledgeView } from "../knowledge/knowledge.js";
import { TestSuite } from "../test-runner/test-suite.js";
import { TraceView } from "../trace/trace.js";
import { Agents } from "../agents/agents.js";
import { AgentDefs } from "../agents/agent-defs.js";
import { Workspace } from "../workspace/workspace.js";

import { Audit } from "../audit/audit.js";

import { Features } from "../features/features.js";
import { assertCanClone } from "./trust.js";

import type { GitHubPort } from "./github-port.js";
import type { PullRequestsPort } from "../pulls/pull-requests-port.js";
import type { SettingsPort } from "../settings/settings-port.js";
import type { MemoryPort } from "../memory/memory-port.js";
import type { TaskStorePort } from "../tasks/task-store-port.js";
import type { AssemblyLinesPort } from "../assembly-lines/assembly-lines-port.js";
import type { NotifyPort } from "../notify/notify-port.js";
import type { KnowledgePort } from "../knowledge/knowledge-port.js";
import type { TestRunnerPort } from "../test-runner/test-runner-port.js";
import type { TracePort } from "../trace/trace-port.js";
import type { AgentRunnerPort } from "../agents/agent-runner-port.js";
import type { AgentDefsPort } from "../agents/agent-defs-port.js";
import type { GitPort } from "../workspace/git-port.js";
import type { LeaseBackend } from "../leases/lease-backends.js";
import type { AuditPort } from "../audit/audit-port.js";
import type { UsagePort } from "../usage/usage-port.js";
import type { FeaturesPort } from "../features/features-port.js";
import type { ChunksPort } from "../chunks/chunks-port.js";

/**
 * The unified internal API. Built by createProject from a repo fullName
 * ("owner/repo") and the two database connections; it holds the ports the
 * factory initialized (adapters are dynamically imported there so this module —
 * and the package barrel — never statically pulls a heavy dep like octokit).
 * A sub-facade for an un-wired port throws a clear error. Writes never live
 * here — they live on the Workspace returned by cache().
 */
export class Project {
  constructor(
    readonly fullName: string,
    private readonly ports: ReadonlyMap<string, unknown>,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  get issues(): IssueCollection {
    return new IssueCollection(this.fullName, this.port<GitHubPort>("github"));
  }

  get repo(): RepoFiles {
    return new RepoFiles(this.fullName, this.port<GitHubPort>("github"));
  }

  get pulls(): PullRequests {
    return new PullRequests(
      this.fullName,
      this.port<PullRequestsPort>("pulls"),
    );
  }

  get settings(): Settings {
    return new Settings(this.fullName, this.port<SettingsPort>("settings"));
  }

  get memory(): Memory {
    return new Memory(this.fullName, this.port<MemoryPort>("memory"));
  }

  get tasks(): TaskList {
    return new TaskList(this.fullName, this.port<TaskStorePort>("tasks"));
  }

  /** First-class assembly line runs (pipeline.assembly_lines); start() fires the assembly_line.start event. */
  get assemblyLines(): AssemblyLines {
    return new AssemblyLines(
      this.fullName,
      this.port<AssemblyLinesPort>("assemblyLines"),
    );
  }

  get notify(): Notify {
    return new Notify(this.fullName, this.port<NotifyPort>("notify"));
  }

  get knowledge(): KnowledgeView {
    return new KnowledgeView(
      this.fullName,
      this.port<KnowledgePort>("knowledge"),
    );
  }

  get tests(): TestSuite {
    return new TestSuite(this.port<TestRunnerPort>("tests"), this.env);
  }

  get trace(): TraceView {
    return new TraceView(this.fullName, this.port<TracePort>("trace"));
  }

  /** Vector-store chunk reads for detection runs (repo's resolved schema). */
  get chunks(): ChunkStore {
    return new ChunkStore(this.fullName, this.port<ChunksPort>("chunks"));
  }

  /** Execution: one ephemeral Agent run (trust-gated). See `agentDefs` for config. */
  get agents(): Agents {
    return new Agents(
      this.fullName,
      this.port<AgentRunnerPort>("agentRunner"),
      this.env,
    );
  }

  /** Agent *definitions* — the stored config CRUD (model/timeout/prompt/image). */
  get agentDefs(): AgentDefs {
    return new AgentDefs(this.fullName, this.port<AgentDefsPort>("agentDefs"));
  }

  /** Branch-lease coordination (supervisor pod ownership). */
  get leases(): LeaseBackend {
    return this.port<LeaseBackend>("leases");
  }

  /** Append-only audit trail (lease takeovers, auto-merge decisions). */
  get audit(): Audit {
    return new Audit(this.fullName, this.port<AuditPort>("audit"));
  }

  /** LLM-call accounting (pipeline.llm_calls). */
  get usage(): UsagePort {
    return this.port<UsagePort>("usage");
  }

  /** Smart feature-planning lifecycle (lore.features + lore.feature_iterations). */
  get features(): Features {
    return new Features(this.fullName, this.port<FeaturesPort>("features"));
  }

  /** Clone the repo to a cache dir and return a Workspace for writes. Refuses on
   *  the shared server — writes require a trusted sandbox. */
  async cache(path: string): Promise<Workspace> {
    assertCanClone(this.env);
    const git = this.port<GitPort>("git");

    await git.clone(this.fullName, path);

    return new Workspace(
      this.fullName,
      path,
      git,
      this.port<PullRequestsPort>("pulls"),
    );
  }

  private port<T>(name: string): T {
    const built = this.ports.get(name);

    enforceTrue(
      built !== undefined,
      Error,
      `Project port "${name}" is not wired yet (pending its live adapter)`,
    );

    return built as T;
  }
}
