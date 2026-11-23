// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearIngestStatusCache } from "@/lib/ingest-status-cache";
import { GET as fileRouteGet } from "./api/repos/[owner]/[repo]/file/route";
import { GET as prStatusGet } from "./api/tasks/[id]/pr-status/route";
import HomePage from "./page";
import OnboardPage from "./onboard/page";
import RepoLayout from "./repos/[owner]/[repo]/layout";
import RepoOverview from "./repos/[owner]/[repo]/page";

interface RecordedApiRequest {
  method: string;
  url: string;
  authorization: string | undefined;
}

const ORIGINAL_ENV = { ...process.env };
const requests: RecordedApiRequest[] = [];
let server: ReturnType<typeof createServer>;
let apiUrl: string;

beforeAll(async () => {
  server = createServer(handleLoreApiRequest);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as { port: number };

  apiUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  requests.length = 0;
  clearIngestStatusCache();
  process.env = { ...ORIGINAL_ENV, LORE_API_URL: apiUrl };
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_APP_INSTALLATION_ID;
  delete process.env.GITHUB_TOKEN;
});

describe("Web UI GitHub reads go through lore-api with the person's session token and no GitHub credentials (FR-037, FR-141, FR-230, FR-232, FR-234)", () => {
  it("reads repository files through lore-api's /github/file route in the file API, home page, and repo overview without GitHub credentials", async () => {
    const fileRes = await fileRouteGet(
      new Request(
        "http://localhost/api/repos/acme/app/file?path=src/index.ts&start=1&end=2",
      ),
      { params: Promise.resolve({ owner: "acme", repo: "app" }) },
    );

    await HomePage({ searchParams: Promise.resolve({}) });
    await RepoOverview({
      params: Promise.resolve({ owner: "acme", repo: "app" }),
    });

    const fileRequests = requests.filter((req) =>
      req.url.startsWith("/api/repos/acme/app/github/file"),
    );

    expect({
      fileStatus: fileRes.status,
      fileBody: await fileRes.json(),
      requestedPaths: fileRequests.map((req) =>
        new URL(req.url, "http://localhost").searchParams.get("path"),
      ),
      allUsedSessionToken:
        fileRequests.length > 0 &&
        fileRequests.every(
          (req) => req.authorization === "Bearer session-token",
        ),
    }).toEqual({
      fileStatus: 200,
      fileBody: {
        path: "src/index.ts",
        start: 1,
        end: 2,
        text: "line1\nline2",
      },
      requestedPaths: [
        "src/index.ts",
        ".github/workflows/lore-ingest.yml",
        ".github/workflows/lore-trace-impact.yml",
        "AGENTS.md",
        ".github/workflows/lore-ingest.yml",
      ],
      allUsedSessionToken: true,
    });
  });

  it("reads README, repository details, and pull request details through lore-api with the person's session token and no GitHub credentials", async () => {
    const onboardElement = (await OnboardPage()) as ReactElement<{
      onboardRepoAction: (
        prev: unknown,
        formData: FormData,
      ) => Promise<{ error: string; fullName: string }>;
    }>;
    const missingForm = new FormData();

    missingForm.set("full_name", "acme/missing");
    const onboardResult = await onboardElement.props.onboardRepoAction(
      null,
      missingForm,
    );
    const prRes = await prStatusGet(
      new Request("http://localhost/api/tasks/task-1/pr-status"),
      { params: Promise.resolve({ id: "task-1" }) },
    );
    const overviewElement = (await RepoOverview({
      params: Promise.resolve({ owner: "acme", repo: "app" }),
    })) as ReactElement<{ readme: { markdown: string } | null }>;
    const layoutElement = await RepoLayout({
      children: null,
      params: Promise.resolve({ owner: "acme", repo: "app" }),
    });

    expect({
      readmeMarkdown: overviewElement.props.readme?.markdown,
      layoutJson: JSON.stringify(layoutElement),
      onboardError: onboardResult.error,
      prStatus: prRes.status,
      prBody: await prRes.json(),
      proxyAuth: [
        authOf("/api/repos/acme/app/github/readme"),
        authOf("/api/repos/acme/app/github/details"),
        authOf("/api/repos/acme/missing/github/details"),
        authOf("/api/repos/acme/app/github/pulls/42"),
      ],
    }).toEqual({
      readmeMarkdown: "# App Readme",
      layoutJson: expect.stringContaining("Acme app repo"),
      onboardError: expect.stringContaining("not found on GitHub"),
      prStatus: 200,
      prBody: {
        number: 42,
        title: "Fix bug",
        state: "open",
        draft: false,
        merged: false,
        mergeable: true,
        html_url: "https://github.com/acme/app/pull/42",
        checks: [{ name: "ci", status: "completed", conclusion: "success" }],
        reviews: [
          {
            user: "ada",
            state: "APPROVED",
            submitted_at: "2026-11-20T00:00:00Z",
          },
        ],
        computed_status: "approved",
      },
      proxyAuth: [
        "Bearer session-token",
        "Bearer session-token",
        "Bearer session-token",
        "Bearer session-token",
      ],
    });
  });
});

function authOf(url: string): string | undefined {
  return requests.find((req) => req.url === url)?.authorization;
}

function handleLoreApiRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "";

  requests.push({
    method: req.method ?? "GET",
    url,
    authorization: req.headers.authorization,
  });

  if (handleGithubProxyStub(url, res) || handleRepoDataStub(url, res)) {
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

const STATIC_PROXY_RESPONSES: Record<
  string,
  { status: number; body: unknown }
> = {
  "/api/repos/acme/app/github/readme": {
    status: 200,
    body: {
      markdown: "# App Readme",
      rawBaseUrl: "https://raw.githubusercontent.com/acme/app/main/",
      htmlUrl: "https://github.com/acme/app/blob/main/README.md",
    },
  },
  "/api/repos/acme/app/github/details": {
    status: 200,
    body: {
      description: "Acme app repo",
      default_branch: "main",
      html_url: "https://github.com/acme/app",
    },
  },
  "/api/repos/acme/missing/github/details": {
    status: 404,
    body: { error: "repository not found" },
  },
  "/api/repos/acme/app/github/pulls/42": {
    status: 200,
    body: {
      number: 42,
      title: "Fix bug",
      state: "open",
      draft: false,
      merged: false,
      mergeable: true,
      html_url: "https://github.com/acme/app/pull/42",
      checks: [{ name: "ci", status: "completed", conclusion: "success" }],
      reviews: [
        {
          user: "ada",
          state: "APPROVED",
          submitted_at: "2026-11-20T00:00:00Z",
        },
      ],
      computed_status: "approved",
    },
  },
};

function handleGithubProxyStub(url: string, res: ServerResponse): boolean {
  if (url.startsWith("/api/repos/acme/app/github/file")) {
    const filePath = new URL(url, "http://localhost").searchParams.get("path");
    const content =
      filePath === "src/index.ts" ? "line1\nline2\nline3" : "name: ok\n";

    sendJson(res, 200, { content });

    return true;
  }

  const matched = STATIC_PROXY_RESPONSES[url];

  if (!matched) {
    return false;
  }

  sendJson(res, matched.status, matched.body);

  return true;
}

function handleRepoDataStub(url: string, res: ServerResponse): boolean {
  const repoRecord = {
    id: "repo-1",
    owner: "acme",
    name: "app",
    full_name: "acme/app",
    team: "platform",
    onboarded_at: "2026-11-01T00:00:00.000Z",
    last_ingested_at: "2026-11-01T00:00:00.000Z",
    onboarding_pr_url: null,
    onboarding_pr_merged: true,
    settings: {},
    outcome_stats: null,
  };

  if (url === "/api/repos" || url.startsWith("/api/repos?")) {
    sendJson(res, 200, {
      repos: [{ ...repoRecord, task_count: 1, active_agents: 0 }],
      total: 1,
      limit: 100,
      offset: 0,
    });

    return true;
  }

  if (url === "/api/repos/available") {
    sendJson(res, 200, []);

    return true;
  }

  if (url === "/api/repos/acme/app") {
    sendJson(res, 200, repoRecord);

    return true;
  }

  if (url === "/api/task/task-1") {
    sendJson(res, 200, {
      id: "task-1",
      target_repo: "acme/app",
      pr_number: 42,
    });

    return true;
  }

  return handleRepoOverviewAuxiliaryStub(url, res);
}

const AUXILIARY_EXACT_STUBS: Record<string, unknown> = {
  "/api/repos/acme/app/chunk-summary": {
    count: 10,
    convention_files: ["CLAUDE.md"],
  },
  "/api/repos/acme/app/sessions": {
    devs: 1,
    last: "2026-11-20T00:00:00.000Z",
  },
  "/api/repos/acme/app/webhook": { state: "configured" },
  "/api/repos/acme/app/activity-counts": { tasks: 2 },
};

function handleRepoOverviewAuxiliaryStub(
  url: string,
  res: ServerResponse,
): boolean {
  const exact = AUXILIARY_EXACT_STUBS[url];

  if (exact) {
    sendJson(res, 200, exact);

    return true;
  }

  if (url.startsWith("/api/repo-tasks?")) {
    sendJson(res, 200, { tasks: [] });

    return true;
  }

  if (url.startsWith("/api/events?")) {
    sendJson(res, 200, { events: [] });

    return true;
  }

  return false;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
