import { Octokit } from "octokit";
import { afterEach, describe, expect, it } from "vitest";
import { guardAppClient, setAppClientWriteGuard } from "./app-client-guard.js";
import { buildOctokit, octokitOptions } from "./platform-github-auth.js";

const ORIGINAL_FETCH = globalThis.fetch;
const GITHUB_ENV_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_TOKEN",
  "GITHUB_HOST",
] as const;
const ORIGINAL_GITHUB_ENV: Partial<
  Record<(typeof GITHUB_ENV_KEYS)[number], string>
> = Object.fromEntries(GITHUB_ENV_KEYS.map((key) => [key, process.env[key]]));

describe("octokitOptions", () => {
  it("returns https://api.github.com when GITHUB_HOST is unset", () => {
    expect(octokitOptions({})).toEqual({ baseUrl: "https://api.github.com" });
  });

  it("returns https://ghe.example.com/api/v3 for host ghe.example.com", () => {
    expect(octokitOptions({ GITHUB_HOST: "ghe.example.com" })).toEqual({
      baseUrl: "https://ghe.example.com/api/v3",
    });
  });
});

describe("buildOctokit write guard", () => {
  afterEach(() => {
    setAppClientWriteGuard(null);
    globalThis.fetch = ORIGINAL_FETCH;
    restoreGithubEnv();
  });

  it("guards a client built from the process env, but not one built from a caller's own env", async () => {
    const guardedMethods: string[] = [];
    const sentPaths: string[] = [];

    setAppClientWriteGuard((method) => {
      guardedMethods.push(method);
      throw new Error("guarded");
    });
    globalThis.fetch = stubGithubFetch(sentPaths);
    clearGithubEnv();

    const own = await buildOctokit(
      { GITHUB_TOKEN: "person-token" },
      { throttle: { enabled: false } },
    );

    await own.request("POST /repos/o/r/git/refs", {
      ref: "refs/heads/x",
      sha: "abc",
    });
    expect({ guardedMethods: [...guardedMethods], sentPaths }).toEqual({
      guardedMethods: [],
      sentPaths: ["POST /repos/o/r/git/refs"],
    });

    process.env.GITHUB_TOKEN = "service-token";
    const app = await buildOctokit(process.env, {
      throttle: { enabled: false },
    });

    await expect(
      app.request("POST /repos/o/r/git/refs", {
        ref: "refs/heads/x",
        sha: "abc",
      }),
    ).rejects.toThrow("guarded");
    expect({ guardedMethods, sentPaths }).toEqual({
      guardedMethods: ["POST"],
      sentPaths: ["POST /repos/o/r/git/refs"],
    });
  });
});

describe("guardAppClient", () => {
  afterEach(() => {
    setAppClientWriteGuard(null);
  });

  it("checks writes but lets GET, HEAD and the installation-token mint pass", async () => {
    const checkedMethods: string[] = [];
    const sentPaths: string[] = [];

    setAppClientWriteGuard((method) => {
      checkedMethods.push(method);
      throw new Error("guarded");
    });
    const client = guardAppClient(
      new Octokit({
        auth: "app-token",
        request: { fetch: stubGithubFetch(sentPaths) },
        throttle: { enabled: false },
      }),
    );

    await client.request("GET /repos/o/r");
    await client.request("HEAD /repos/o/r");
    await client.request(
      "POST /app/installations/{installation_id}/access_tokens",
      { installation_id: 42 },
    );
    expect({ checkedMethods: [...checkedMethods], sentPaths }).toEqual({
      checkedMethods: [],
      sentPaths: [
        "GET /repos/o/r",
        "HEAD /repos/o/r",
        "POST /app/installations/42/access_tokens",
      ],
    });

    await expect(client.request("PATCH /repos/o/r")).rejects.toThrow("guarded");
    expect({ checkedMethods, sentPaths }).toEqual({
      checkedMethods: ["PATCH"],
      sentPaths: [
        "GET /repos/o/r",
        "HEAD /repos/o/r",
        "POST /app/installations/42/access_tokens",
      ],
    });
  });
});

function stubGithubFetch(sentPaths: string[]): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);

    if (
      !url.pathname.startsWith("/repos/") &&
      !url.pathname.startsWith("/app/installations/")
    ) {
      return new Response('{"message":"not found"}', {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    sentPaths.push(`${method} ${url.pathname}`);

    return new Response(method === "HEAD" ? null : "{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }

  return new URL(typeof input === "string" ? input : input.url);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  return typeof input === "string" || input instanceof URL
    ? "GET"
    : input.method.toUpperCase();
}

function clearGithubEnv(): void {
  for (const key of GITHUB_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreGithubEnv(): void {
  for (const key of GITHUB_ENV_KEYS) {
    const previous = ORIGINAL_GITHUB_ENV[key];

    if (previous === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = previous;
  }
}
