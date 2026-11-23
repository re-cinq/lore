import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initPool, resetPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { startEnrolStation } from "./station.js";

const FLOOR_URL = "http://floor.test";
const LORE_API_URL = "http://lore-api.test";
const APP_TOKEN = "ghs_enrol_app_token";
const STATION_TOKEN = "lore_station_service_token";
const CARRIED_CREDENTIAL = "lore_carried_onboard_credential";
const REPO_SECRET_PUBLIC_KEY = randomBytes(32).toString("base64");
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

interface RecordedCommit {
  via: "github" | "lore-api";
  repo: string;
  path: string;
  authorization: string;
}

describe("onboard-enrol station credential acceptance (FR-296)", () => {
  beforeEach(() => {
    configureEnv();
    initPool();
  });

  afterEach(() => {
    resetPool();
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("commits onboarding files with the carried credential rather than the App token when the onboard run carries one", async () => {
    const { commits, report } = await runEnrolOnce(
      needsWithCarriedCredential(),
    );

    expect({
      outcome: report.outcome,
      hasCommits: commits.length > 0,
      repos: commitRepos(commits),
      actors: commitActors(commits),
    }).toEqual({
      outcome: "success",
      hasCommits: true,
      repos: ["acme/new-repo"],
      actors: ["carried"],
    });
  }, 60_000);

  it("commits onboarding files as the App when the onboard run carries no person credential", async () => {
    const { commits, report } = await runEnrolOnce(
      baseEnrolNeeds("acme/other-repo"),
    );

    expect({
      outcome: report.outcome,
      hasCommits: commits.length > 0,
      repos: commitRepos(commits),
      actors: commitActors(commits),
    }).toEqual({
      outcome: "success",
      hasCommits: true,
      repos: ["acme/other-repo"],
      actors: ["app"],
    });
  }, 60_000);

  it("commits nothing as the App when GitHub refuses the carried credential", async () => {
    const refused: string[] = [];
    const { commits } = await runEnrolOnce(
      needsWithCarriedCredential(),
      (inner) => async (input, init) => {
        const req = await resolveRequest(input, init);

        if (
          req.method === "PUT" &&
          req.url.includes("/repos/acme/new-repo/contents/") &&
          req.authorization.includes(CARRIED_CREDENTIAL)
        ) {
          refused.push(req.url);

          return jsonResponse({ message: "Bad credentials" }, 401);
        }

        return inner(input, init);
      },
    );

    expect({
      refusedCarried: refused.length > 0,
      actors: commitActors(commits),
    }).toEqual({ refusedCarried: true, actors: [] });
  }, 60_000);
});

function commitRepos(commits: RecordedCommit[]): string[] {
  return [...new Set(commits.map((commit) => commit.repo))];
}

function commitActors(commits: RecordedCommit[]): string[] {
  return [...new Set(commits.map((commit) => actorOf(commit.authorization)))];
}

function actorOf(authorization: string): string {
  if (authorization.includes(CARRIED_CREDENTIAL)) {
    return "carried";
  }

  if (authorization.includes(APP_TOKEN)) {
    return "app";
  }

  if (authorization.includes(STATION_TOKEN)) {
    return "station";
  }

  return authorization || "none";
}

function configureEnv(): void {
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_APP_INSTALLATION_ID;
  process.env.GITHUB_TOKEN = APP_TOKEN;
  process.env.FLOOR_API_URL = FLOOR_URL;
  process.env.FLOOR_SERVICE_TOKEN = "floor-service-token";
  process.env.LORE_API_URL = LORE_API_URL;
  process.env.LORE_STATION_TOKEN = STATION_TOKEN;
  process.env.LORE_INGEST_URL = "https://lore.test/ingest";
  process.env.LORE_DB_HOST = "127.0.0.1";
  process.env.LORE_DB_PORT = "5432";
  process.env.LORE_DB_NAME = "lore";
  process.env.LORE_DB_USER = "lore";
}

function baseEnrolNeeds(repo = "acme/new-repo"): Array<Record<string, string>> {
  return [
    {
      name: "target",
      kind: "git",
      repoUrl: `https://github.com/${repo}`,
      ref: "lore/onboard/task-1",
    },
    { name: "task_id", kind: "value", value: "task-1" },
  ];
}

function needsWithCarriedCredential(): Array<Record<string, string>> {
  const needs = baseEnrolNeeds();

  for (const extra of extraEnrolNeeds()) {
    needs.push(
      extra.kind === "file"
        ? { name: extra.name, kind: "file", url: `${FLOOR_URL}/blobs/cred` }
        : { name: extra.name, kind: "value", value: CARRIED_CREDENTIAL },
    );
  }

  return needs;
}

function extraEnrolNeeds(): Array<{ name: string; kind: string }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const yamlPath = resolve(
    here,
    "../../../../../libs/assembly-lines/src/floor-pipelines/onboard.yaml",
  );
  const block = readEnrolNeedsBlock(readFileSync(yamlPath, "utf-8"));

  return parseNeedEntries(block).filter(
    (needEntry) => needEntry.name !== "target" && needEntry.name !== "task_id",
  );
}

function readEnrolNeedsBlock(yamlText: string): string {
  const stationStart = yamlText.indexOf("  onboard-enrol:");
  const nextStation = yamlText.indexOf("  onboard-author:", stationStart);
  const section = yamlText.slice(stationStart, nextStation);
  const needsStart = section.indexOf("    needs:");
  const producesStart = section.indexOf("    produces:", needsStart);

  return section.slice(needsStart, producesStart);
}

function parseNeedEntries(
  block: string,
): Array<{ name: string; kind: string }> {
  const entries: Array<{ name: string; kind: string }> = [];
  const lines = block.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*-\s*name:\s*(\S+)/.exec(lines[index]);

    if (match) {
      const kindLine = lines[index + 1] ?? "";
      const kindMatch = /kind:\s*(\S+)/.exec(kindLine);

      entries.push({ name: match[1], kind: kindMatch?.[1] ?? "value" });
    }
  }

  return entries;
}

async function runEnrolOnce(
  needs: Array<Record<string, string>>,
  wrapFetch: (inner: typeof fetch) => typeof fetch = (inner) => inner,
) {
  const commits: RecordedCommit[] = [];
  let resolveReport: (report: Record<string, unknown>) => void = () => {};
  const reportPromise = new Promise<Record<string, unknown>>((resolve) => {
    resolveReport = resolve;
  });

  globalThis.fetch = wrapFetch(createEnrolFetch(needs, commits, resolveReport));
  const station = startEnrolStation();

  try {
    const report = await reportPromise;

    return { commits, report };
  } finally {
    await station.stop();
  }
}

function createEnrolFetch(
  needs: Array<Record<string, string>>,
  commits: RecordedCommit[],
  onReport: (report: Record<string, unknown>) => void,
): typeof fetch {
  let claimed = false;

  return async (input, init) => {
    const req = await resolveRequest(input, init);
    const url = new URL(req.url);

    if (url.hostname === "floor.test") {
      return handleFloor(url, req.bodyText, needs, {
        takeClaim: () => {
          const hit = !claimed;

          claimed = true;

          return hit;
        },
        onReport,
      });
    }

    if (url.hostname === "lore-api.test") {
      return handleLoreApi(url, req, commits);
    }

    if (url.hostname === "api.github.com") {
      return handleGithub(url, req, commits);
    }

    return new Response("not found", { status: 404 });
  };
}

async function resolveRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{
  method: string;
  url: string;
  authorization: string;
  bodyText: string;
}> {
  if (input instanceof Request) {
    return requestFromInstance(input, init);
  }

  return requestFromInit(input, init);
}

async function requestFromInstance(
  input: Request,
  init: RequestInit | undefined,
) {
  return {
    method: (init?.method ?? input.method).toUpperCase(),
    url: input.url,
    authorization:
      headerOf(init?.headers, "authorization") ||
      input.headers.get("authorization") ||
      "",
    bodyText: await input.clone().text(),
  };
}

function requestFromInit(input: string | URL, init: RequestInit | undefined) {
  return {
    method: (init?.method ?? "GET").toUpperCase(),
    url: input.toString(),
    authorization: headerOf(init?.headers, "authorization"),
    bodyText: typeof init?.body === "string" ? init.body : "",
  };
}

function headerOf(headers: HeadersInit | undefined, name: string): string {
  if (!headers) {
    return "";
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }

  return headerFromEntries(headers, name.toLowerCase());
}

function headerFromEntries(
  headers: Exclude<HeadersInit, Headers>,
  target: string,
): string {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);

  return entries.find(([key]) => key.toLowerCase() === target)?.[1] ?? "";
}

function handleFloor(
  url: URL,
  bodyText: string,
  needs: Array<Record<string, string>>,
  hooks: {
    takeClaim: () => boolean;
    onReport: (report: Record<string, unknown>) => void;
  },
): Response {
  if (url.pathname === "/events/claim") {
    return jsonResponse(
      hooks.takeClaim()
        ? [
            {
              id: "evt-1",
              name: "station_run.dispatch",
              payload: { visitId: "visit-1" },
            },
          ]
        : [],
    );
  }

  if (url.pathname === "/station-runs/visit-1/brief") {
    return jsonResponse({
      visitId: "visit-1",
      iteration: 1,
      deadlineMinutes: 10,
      token: "visit-token",
      needs,
    });
  }

  return handleFloorMutation(url, bodyText, hooks.onReport);
}

function handleFloorMutation(
  url: URL,
  bodyText: string,
  onReport: (report: Record<string, unknown>) => void,
): Response {
  if (url.pathname === "/blobs/cred") {
    return new Response(CARRIED_CREDENTIAL, { status: 200 });
  }

  if (url.pathname === "/events/evt-1/ack") {
    return new Response(null, { status: 204 });
  }

  return handleFloorEventPost(url, bodyText, onReport);
}

function handleFloorEventPost(
  url: URL,
  bodyText: string,
  onReport: (report: Record<string, unknown>) => void,
): Response {
  if (url.pathname === "/events") {
    const parsed = JSON.parse(bodyText) as {
      payload?: { report?: Record<string, unknown> };
    };

    onReport(parsed.payload?.report ?? {});

    return jsonResponse({ ok: true }, 201);
  }

  if (url.pathname === "/events/evt-1/fail") {
    const parsed = JSON.parse(bodyText) as { error?: string };

    onReport({ outcome: "station_failed", error: parsed.error ?? "unknown" });

    return new Response(null, { status: 204 });
  }

  return new Response("not found", { status: 404 });
}

function handleLoreApi(
  url: URL,
  req: { method: string; authorization: string; bodyText: string },
  commits: RecordedCommit[],
): Response {
  const match = /^\/api\/repos\/([^/]+\/[^/]+)\/commit$/.exec(url.pathname);

  if (req.method === "POST" && match) {
    const parsed = JSON.parse(req.bodyText) as { path?: string };

    commits.push({
      via: "lore-api",
      repo: match[1],
      path: parsed.path ?? "",
      authorization: req.authorization,
    });

    return jsonResponse({ ok: true }, 200);
  }

  return new Response("not found", { status: 404 });
}

function handleGithub(
  url: URL,
  req: { method: string; authorization: string },
  commits: RecordedCommit[],
): Response {
  if (/^\/repos\/[^/]+\/[^/]+\/labels$/.test(url.pathname)) {
    return labelResponse(req.method);
  }

  if (/^\/repos\/[^/]+\/[^/]+\/actions\//.test(url.pathname)) {
    return actionsResponse(url.pathname, req.method);
  }

  return handleGithubContents(url, req, commits);
}

function labelResponse(method: string): Response {
  const isGet = method === "GET";

  return jsonResponse(isGet ? [] : { name: "label" }, isGet ? 200 : 201);
}

function actionsResponse(pathname: string, method: string): Response {
  if (pathname.endsWith("/actions/secrets/public-key")) {
    return jsonResponse({ key_id: "key-1", key: REPO_SECRET_PUBLIC_KEY });
  }

  if (pathname.includes("/actions/variables")) {
    return method === "PATCH"
      ? new Response("not found", { status: 404 })
      : new Response(null, { status: 201 });
  }

  return new Response(null, { status: 204 });
}

function handleGithubContents(
  url: URL,
  req: { method: string; authorization: string },
  commits: RecordedCommit[],
): Response {
  const match = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(url.pathname);

  if (!match || req.method !== "PUT") {
    return new Response("not found", { status: 404 });
  }

  commits.push({
    via: "github",
    repo: match[1],
    path: match[2],
    authorization: req.authorization,
  });

  return jsonResponse({ content: { sha: "c0ffee" } }, 201);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
