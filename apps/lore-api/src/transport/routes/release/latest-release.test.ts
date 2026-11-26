import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import {
  latestReleaseRoute,
  type LatestReleaseSeams,
} from "./latest-release.js";

const HOUR_MS = 60 * 60 * 1000;
const GITHUB_LATEST_URL =
  "https://api.github.com/repos/re-cinq/lore/releases/latest";
const RELEASE_BODY = {
  tag_name: "v1.3.0",
  html_url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
};

interface Clock {
  now: number;
}

function okResponse() {
  return new Response(JSON.stringify(RELEASE_BODY), { status: 200 });
}

async function serve(seams: LatestReleaseSeams) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(latestReleaseRoute(seams));

  return server;
}

function seamsFor(
  response: () => Response,
  calls: string[],
  clock: Clock = { now: 0 },
): LatestReleaseSeams {
  return {
    publicRepo: "re-cinq/lore",
    fetch: githubAnswering(response, calls),
    now: () => clock.now,
  };
}

function githubAnswering(
  response: () => Response,
  calls: string[],
): LatestReleaseSeams["fetch"] {
  return async (url) => {
    calls.push(String(url));

    return response();
  };
}

describe("GET /api/release", () => {
  it("answers the latest tag, its notes url and the releases page for re-cinq/lore", async () => {
    const calls: string[] = [];
    const server = await serve(seamsFor(okResponse, calls));

    const res = await server.inject("/api/release");

    expect(calls).toEqual([GITHUB_LATEST_URL]);
    expect(JSON.parse(res.payload)).toEqual({
      latest: "v1.3.0",
      url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
      releasesUrl: "https://github.com/re-cinq/lore/releases",
      updateAvailable: false,
    });
  });

  it("answers updateAvailable true when running v1.2.3 and latest is v1.3.0", async () => {
    const server = await serve(seamsFor(okResponse, []));

    const res = await server.inject("/api/release?running=v1.2.3");

    expect(JSON.parse(res.payload)).toMatchObject({ updateAvailable: true });
  });

  it("answers updateAvailable false when running the build 0caa086", async () => {
    const server = await serve(seamsFor(okResponse, []));

    const res = await server.inject("/api/release?running=0caa086");

    expect(JSON.parse(res.payload)).toMatchObject({ updateAvailable: false });
  });

  it("asks GitHub once for two requests within the hour", async () => {
    const calls: string[] = [];
    const clock: Clock = { now: 0 };
    const server = await serve(seamsFor(okResponse, calls, clock));

    await server.inject("/api/release");
    clock.now = HOUR_MS - 1;
    await server.inject("/api/release");

    expect(calls).toEqual([GITHUB_LATEST_URL]);
  });

  it("asks GitHub again once the hour has passed", async () => {
    const calls: string[] = [];
    const clock: Clock = { now: 0 };
    const server = await serve(seamsFor(okResponse, calls, clock));

    await server.inject("/api/release");
    clock.now = HOUR_MS;
    await server.inject("/api/release");

    expect(calls).toEqual([GITHUB_LATEST_URL, GITHUB_LATEST_URL]);
  });

  it("answers latest null when GitHub answers 500, and does not ask again within the hour", async () => {
    const calls: string[] = [];
    const server = await serve(
      seamsFor(() => new Response("boom", { status: 500 }), calls),
    );

    const first = await server.inject("/api/release");

    await server.inject("/api/release");

    expect(JSON.parse(first.payload)).toEqual({
      latest: null,
      url: null,
      releasesUrl: "https://github.com/re-cinq/lore/releases",
      updateAvailable: false,
    });
    expect(calls).toEqual([GITHUB_LATEST_URL]);
  });

  it("answers latest null when the fetch to GitHub fails", async () => {
    const server = await serve({
      publicRepo: "re-cinq/lore",
      fetch: async () => {
        throw new Error("network down");
      },
      now: () => 0,
    });

    const res = await server.inject("/api/release");

    expect(JSON.parse(res.payload)).toMatchObject({ latest: null, url: null });
  });
});
