import type { PgPool, DgraphClientPort } from "../../memory-store.js";
import { selectMemoryStore } from "../../memory-store.js";

import { IssueCollection } from "../issues/issues.js";
import { RepoFiles } from "../repo/repo-files.js";
import { PullRequests } from "../pulls/pull-requests.js";
import { Settings } from "../settings/settings.js";
import { PgSettings } from "../settings/settings-pg.js";
import { Memory } from "../memory/memory.js";
import { MemoryStoreBridge } from "../memory/memory-store-bridge.js";
import { TaskList } from "../tasks/task-list.js";
import { PgTaskStore } from "../tasks/task-store-pg.js";
import { Notify } from "../notify/notify.js";
import { NotifySlack } from "../notify/notify-slack.js";
import { KnowledgeView } from "../knowledge/knowledge.js";
import { TestSuite } from "../test-runner/test-suite.js";
import { Agents } from "../agents/agents.js";
import { Workspace } from "../workspace/workspace.js";
import { GitCli } from "../workspace/git-cli.js";
import { assertCanClone } from "./trust.js";

import type { GitHubPort } from "./github-port.js";
import type { PullRequestsPort } from "../pulls/pull-requests-port.js";
import type { SettingsPort } from "../settings/settings-port.js";
import type { MemoryPort } from "../memory/memory-port.js";
import type { TaskStorePort } from "../tasks/task-store-port.js";
import type { NotifyPort } from "../notify/notify-port.js";
import type { KnowledgePort } from "../knowledge/knowledge-port.js";
import type { TestRunnerPort } from "../test-runner/test-runner-port.js";
import type { AgentRunnerPort } from "../agents/agent-runner-port.js";
import type { GitPort } from "../workspace/git-port.js";

/**
 * The unified internal API. Constructed from a repo fullName ("owner/repo") and
 * the two database connections — Postgres + Dgraph; the GitHub/git/exec ports
 * read ambient env + local tooling. The Project OWNS port initialization: each
 * port is built lazily on first use and memoized, so no adapter is created
 * before the Project exists. Writes never live here — they live on the
 * Workspace returned by cache().
 */
export class Project {
  private readonly ports = new Map<string, unknown>();

  constructor(
    readonly fullName: string,
    private readonly pg: PgPool,
    private readonly dgraph: DgraphClientPort,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  get issues(): IssueCollection {
    return new IssueCollection(this.fullName, this.github());
  }

  get repo(): RepoFiles {
    return new RepoFiles(this.fullName, this.github());
  }

  get pulls(): PullRequests {
    return new PullRequests(this.fullName, this.port<PullRequestsPort>("pulls"));
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

  get notify(): Notify {
    return new Notify(this.fullName, this.port<NotifyPort>("notify"));
  }

  get knowledge(): KnowledgeView {
    return new KnowledgeView(this.fullName, this.port<KnowledgePort>("knowledge"));
  }

  get tests(): TestSuite {
    return new TestSuite(this.port<TestRunnerPort>("tests"), this.env);
  }

  get agents(): Agents {
    return new Agents(this.fullName, this.port<AgentRunnerPort>("agents"), this.env);
  }

  /** Clone the repo to a cache dir and return a Workspace for writes. Refuses on
   *  the shared server — writes require a trusted sandbox. */
  async cache(path: string): Promise<Workspace> {
    assertCanClone(this.env);
    const git = this.port<GitPort>("git");
    await git.clone(this.fullName, path);
    return new Workspace(this.fullName, path, git, this.port<PullRequestsPort>("pulls"));
  }

  private github(): GitHubPort {
    return this.port<GitHubPort>("github");
  }

  /** Lazily build and memoize a port from the connections/env. */
  private port<T>(name: string): T {
    const cached = this.ports.get(name);
    if (cached !== undefined) return cached as T;
    const built = this.build(name);
    this.ports.set(name, built);
    return built as T;
  }

  private build(name: string): unknown {
    switch (name) {
      case "memory":
        return new MemoryStoreBridge(selectMemoryStore({ pgPool: this.pg, dgraph: this.dgraph }));
      case "tasks":
        return new PgTaskStore(this.pg);
      case "git":
        return new GitCli(this.env);
      case "settings":
        return new PgSettings(this.pg);
      case "notify":
        return new NotifySlack(this.pg, this.env);
      default:
        throw new Error(`Project port "${name}" is not wired yet (pending its live adapter)`);
    }
  }
}
