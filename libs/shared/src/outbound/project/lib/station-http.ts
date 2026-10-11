import { enforceTrue } from "../../../lib/enforce.js";
import { bearerJsonHeaders } from "./http-auth.js";
import type { FileChange } from "./github-port.js";
import type { PullDraft } from "../pulls/pull-requests-port.js";
import { Project } from "./project.js";
import { ChunksHttp } from "../chunks/chunks-http.js";
import type { IssueRef, IssueFilter, IssueEdit } from "./github-port.js";
import type { PullRef } from "../pulls/pull-requests-port.js";
import type { CiConclusion } from "../pulls/pull-requests-port.js";
import type { TraceDocument } from "../../../domain/spec-trace/assemble-trace-document.js";
import { TaskStoreHttp } from "../tasks/task-store-http.js";

/** HTTP-backed Project for detection pods (proxies Lore API; ADR-031 D6/D7). */

interface HttpConfig {
  baseUrl: string;
  repo: string;
  token?: string;
  fetchImpl: typeof fetch;
}

/** A station pod holds no database and no App credentials (D7), so every read and write it makes is one of these calls against the repo-scoped API. */
function makeHttp(cfg: HttpConfig) {
  const headers = bearerJsonHeaders(cfg.token);
  const base = `${cfg.baseUrl}/api/repos/${cfg.repo}`;

  const call = { fetchImpl: cfg.fetchImpl, base, headers };

  return {
    get: <T>(path: string, query: Record<string, string> = {}): Promise<T> =>
      httpGet<T>(call, path, query),
    post: <T>(path: string, body: unknown): Promise<T> =>
      httpSend<T>(call, "POST", path, body),
    patch: <T>(path: string, body: unknown): Promise<T> =>
      httpSend<T>(call, "PATCH", path, body),
    put: <T>(path: string, body: unknown): Promise<T> =>
      httpSend<T>(call, "PUT", path, body),
  };
}

interface HttpCall {
  fetchImpl: typeof fetch;
  base: string;
  headers: Record<string, string>;
}

function httpGet<T>(
  call: HttpCall,
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const qs = new URLSearchParams(query).toString();

  return unwrap(
    call.fetchImpl(`${call.base}${path}${qs ? `?${qs}` : ""}`, {
      headers: call.headers,
    }),
    `GET ${path}`,
  );
}

function httpSend<T>(
  call: HttpCall,
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
): Promise<T> {
  return unwrap(
    call.fetchImpl(`${call.base}${path}`, {
      method,
      headers: call.headers,
      body: JSON.stringify(body),
    }),
    `${method} ${path}`,
  );
}

/** The parsed body, or a throw naming the call that failed and lore-api's own reason — a bare `500` sent plan 3b3a67af's issues station hunting through logs for a trust refusal lore-api had already put in words. */
async function unwrap<T>(
  pending: Promise<Response>,
  label: string,
): Promise<T> {
  const res = await pending;

  if (!res.ok) {
    const reason = await refusalReason(res);

    throw new Error(
      `${label} failed: ${res.status}${reason ? ` — ${reason}` : ""}`,
    );
  }

  return (await res.json()) as T;
}

// lore-api answers `{ error }`; any other body, or none, adds nothing to the status.
async function refusalReason(res: Response): Promise<string | null> {
  const text = await res.text().catch(() => "");

  try {
    const parsed = JSON.parse(text) as { error?: unknown };

    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
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
        ...(filter?.labels?.length ? { labels: filter.labels.join(",") } : {}),
      })
    ).issues;
  }
  /** HTTP client already repo-scoped; repo argument unused. */
  async listLabels(_repo: string): Promise<string[]> {
    return (await this.http.get<{ labels: string[] }>("/labels")).labels;
  }

  async createIssue(
    _repo: string,
    title: string,
    body: string,
    labels?: string[],
  ): Promise<IssueRef> {
    return this.http.post<IssueRef>("/issues", { title, body, labels });
  }
  async addSubIssue(
    _repo: string,
    parentNumber: number,
    childNumber: number,
  ): Promise<void> {
    await this.http.post(`/issues/${parentNumber}/sub-issues`, {
      child: childNumber,
    });
  }
  async updateIssue(
    _repo: string,
    number: number,
    edit: IssueEdit,
  ): Promise<void> {
    await this.http.patch(`/issues/${number}`, edit);
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
    { path, content, message }: FileChange,
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
    { title, body, base, labels }: PullDraft,
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

/** Compose the pod-only Project for repo (requires LORE_API_URL). */
export function createStationProject(
  repo: string,
  env: StationProjectEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Project {
  const baseUrl = env.LORE_API_URL;

  enforceTrue(baseUrl, Error, "createStationProject requires LORE_API_URL");
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

/** Asks lore-api to drop a branch's graph overlay: a process that holds no graph client (the stations service) tells the graph a closed pull request's branch is done. Safe to call twice. */
export async function dropOverlayOverHttp(
  target: { repo: string; branch: string },
  env: StationProjectEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const baseUrl = env.LORE_API_URL;

  enforceTrue(baseUrl, Error, "dropOverlayOverHttp requires LORE_API_URL");
  const token = env.LORE_STATION_TOKEN ?? env.LORE_INGEST_TOKEN;
  const http = makeHttp({ baseUrl, repo: target.repo, token, fetchImpl });

  await http.post("/trace/overlay-drop", { branch: target.branch });
}
