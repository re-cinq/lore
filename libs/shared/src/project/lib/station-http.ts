import { enforceTrue } from "../../lib/enforce.js";
import { Project } from "./project.js";
import { ChunksHttp } from "../chunks/chunks-http.js";
import type { IssueRef, IssueFilter } from "./github-port.js";
import type { PullRef } from "../pulls/pull-requests-port.js";
import type { CiConclusion } from "../pulls/pull-requests-port.js";
import type { TraceDocument } from "../../spec-trace/assemble-trace-document.js";
import type { PipelineTask } from "../../types.js";
import type {
  DriftTaskRow,
  FindOpenLikeInput,
  CreateTaskInput,
} from "../tasks/task-store-port.js";

/**
 * The HTTP-backed Project a detection **station pod** runs on. A pod can't reach
 * Postgres, Dgraph, or the GitHub App (ADR-031 D6/D7), so every port it uses
 * proxies the Lore API over a scoped token + allowed egress. Only the methods
 * the detectors call are implemented — the adapters are cast into the ports map
 * (which is untyped), so an unused method surfaces as a runtime miss, never a
 * silent DB/GitHub reach. The Floor keeps its full Pg/octokit Project via
 * createProject; this is the pod-only sibling.
 */

interface HttpConfig {
  baseUrl: string;
  repo: string;
  token?: string;
  fetchImpl: typeof fetch;
}

function makeHttp(cfg: HttpConfig) {
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { "content-type": "application/json" };

    if (cfg.token) {
      h["authorization"] = `Bearer ${cfg.token}`;
    }

    return h;
  };
  const base = `${cfg.baseUrl}/api/repos/${cfg.repo}`;

  return {
    async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
      const qs = new URLSearchParams(query).toString();
      const res = await cfg.fetchImpl(`${base}${path}${qs ? `?${qs}` : ""}`, {
        headers: headers(),
      });

      if (!res.ok) {
        throw new Error(`GET ${path} failed: ${res.status}`);
      }

      return (await res.json()) as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      const res = await cfg.fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`POST ${path} failed: ${res.status}`);
      }

      return (await res.json()) as T;
    },
  };
}

type Http = ReturnType<typeof makeHttp>;

/** GitHubPort subset: issue list/create + branch/commit (backfill). */
class GitHubHttp {
  constructor(
    private readonly repo: string,
    private readonly http: Http,
  ) {}
  readonly name = "github-http";
  isConfigured(): boolean {
    return true;
  }
  async listIssues(_repo: string, filter?: IssueFilter): Promise<IssueRef[]> {
    return (
      await this.http.get<{ issues: IssueRef[] }>("/issues", {
        state: filter?.state ?? "open",
      })
    ).issues;
  }
  async createIssue(
    _repo: string,
    title: string,
    body: string,
    labels?: string[],
  ): Promise<IssueRef> {
    return this.http.post<IssueRef>("/issues", { title, body, labels });
  }
  async createBranch(
    _repo: string,
    branch: string,
    base?: string,
  ): Promise<void> {
    await this.http.post("/branches", { branch, base });
  }
  async commitFile(
    _repo: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<void> {
    await this.http.post("/commit", { branch, path, content, message });
  }
}

/** PullRequestsPort subset: open + ciConclusion. */
class PullsHttp {
  constructor(private readonly http: Http) {}
  async open(
    _repo: string,
    branch: string,
    title: string,
    body: string,
    base?: string,
    labels?: string[],
  ): Promise<PullRef> {
    return this.http.post<PullRef>("/pulls", {
      branch,
      title,
      body,
      base,
      labels,
    });
  }
  async ciConclusion(_repo: string, ref: string): Promise<CiConclusion> {
    return (
      await this.http.get<{ conclusion: CiConclusion }>("/ci-conclusion", {
        ref,
      })
    ).conclusion;
  }
}

/** TracePort subset: document. */
class TraceHttp {
  constructor(private readonly http: Http) {}
  async document(_repo: string, filePath: string): Promise<TraceDocument> {
    return this.http.get<TraceDocument>("/trace/document", { path: filePath });
  }
}

/** TaskStorePort subset: driftTasksForSpec + findOpenLike + create. */
class TaskStoreHttp {
  constructor(private readonly http: Http) {}
  async driftTasksForSpec(
    _repo: string,
    taskType: string,
    specPath: string,
  ): Promise<DriftTaskRow[]> {
    return (
      await this.http.get<{ tasks: DriftTaskRow[] }>("/tasks/drift", {
        task_type: taskType,
        spec_path: specPath,
      })
    ).tasks;
  }
  async findOpenLike(input: FindOpenLikeInput): Promise<PipelineTask[]> {
    return (
      await this.http.get<{ tasks: PipelineTask[] }>("/tasks/open-like", {
        task_type: input.taskType,
        description_prefix: input.descriptionPrefix,
        statuses: [...input.statuses].join(","),
      })
    ).tasks;
  }
  async create(input: CreateTaskInput): Promise<unknown> {
    return this.http.post("/tasks", {
      description: input.description,
      taskType: input.taskType,
      createdBy: input.createdBy,
      contextBundle: input.contextBundle,
    });
  }
}

/** SettingsPort subset: isOnboarded. */
class SettingsHttp {
  constructor(private readonly http: Http) {}
  async isOnboarded(_repo: string): Promise<boolean> {
    return (await this.http.get<{ onboarded: boolean }>("/onboarded"))
      .onboarded;
  }
}

export interface StationProjectEnv {
  LORE_API_URL?: string;
  LORE_STATION_TOKEN?: string;
  LORE_INGEST_TOKEN?: string;
}

/**
 * Compose the pod-only Project for `repo`. Requires LORE_API_URL; the token is
 * LORE_STATION_TOKEN (falls back to LORE_INGEST_TOKEN). fetchImpl is injectable
 * for tests.
 */
export function createStationProject(
  repo: string,
  env: StationProjectEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Project {
  const baseUrl = env.LORE_API_URL;

  enforceTrue(baseUrl, new Error("createStationProject requires LORE_API_URL"));
  const token = env.LORE_STATION_TOKEN ?? env.LORE_INGEST_TOKEN;
  const http = makeHttp({ baseUrl, repo, token, fetchImpl });

  const ports = new Map<string, unknown>([
    ["chunks", new ChunksHttp(baseUrl, repo, token, fetchImpl)],
    ["github", new GitHubHttp(repo, http)],
    ["pulls", new PullsHttp(http)],
    ["trace", new TraceHttp(http)],
    ["tasks", new TaskStoreHttp(http)],
    ["settings", new SettingsHttp(http)],
  ]);

  return new Project(repo, ports, env as NodeJS.ProcessEnv);
}
