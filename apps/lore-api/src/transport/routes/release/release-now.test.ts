import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { releaseNowRoute, type ReleaseLines } from "./release-now.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

function scene({ withFloor }: { withFloor: boolean } = { withFloor: true }) {
  const started: Array<{ line: string; key: unknown }> = [];
  const opened = new Map<string, string>();
  const lines: NonNullable<ReturnType<ReleaseLines>> = {
    start: (line, starting) => {
      const key = (starting.startItems?.release_key as { ref: string }).ref;
      const joined = opened.has(key);

      opened.set(key, opened.get(key) ?? `run-${opened.size + 44}`);
      started.push({ line, key });

      return Promise.resolve({
        run: { id: opened.get(key) },
        joined,
      } as never);
    },
  };
  const settings = new InMemorySettings([
    {
      full_name: "re-cinq/lore-security",
      settings: { public_mirror: "re-cinq/lore" },
    },
    { full_name: "re-cinq/lore", settings: {} },
    { full_name: "re-cinq/otto", settings: null },
  ]);
  const server = Hapi.server();

  registerBearerScope(server, () => null);
  server.route(
    releaseNowRoute(() => null, {
      settings: () => settings,
      lines: () => (withFloor ? lines : null),
      headSha: () => Promise.resolve(HEAD),
    }),
  );

  const post = async (repo: string) => {
    const res = await server.inject({
      method: "POST",
      url: `/api/repos/${repo}/release`,
      headers: AUTH,
    });

    return { status: res.statusCode, body: JSON.parse(res.payload) };
  };

  return { post, started };
}

describe("POST /api/repos/{owner}/{repo}/release", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("starts release for re-cinq/otto at head a1b2c3d, with no release block in its settings, and answers 202 with run-44", async () => {
    const { post, started } = scene();

    expect({ response: await post("re-cinq/otto"), started }).toEqual({
      response: { status: 202, body: { runId: "run-44", joined: false } },
      started: [{ line: "release", key: `re-cinq/otto:${HEAD}` }],
    });
  });

  it("joins run-44 when re-cinq/otto is released twice at the same head", async () => {
    const { post, started } = scene();

    await post("re-cinq/otto");

    expect({
      response: await post("re-cinq/otto"),
      count: started.length,
    }).toEqual({
      response: { status: 202, body: { runId: "run-44", joined: true } },
      count: 2,
    });
  });

  it("refuses re-cinq/lore, the public mirror of re-cinq/lore-security, with 409 and starts nothing", async () => {
    const { post, started } = scene();

    expect({ status: (await post("re-cinq/lore")).status, started }).toEqual({
      status: 409,
      started: [],
    });
  });

  it("refuses re-cinq/unknown with 404 and starts nothing", async () => {
    const { post, started } = scene();

    expect({ status: (await post("re-cinq/unknown")).status, started }).toEqual(
      {
        status: 404,
        started: [],
      },
    );
  });

  it("answers 503 when no floor is configured", async () => {
    expect(
      (await scene({ withFloor: false }).post("re-cinq/otto")).status,
    ).toBe(503);
  });
});
