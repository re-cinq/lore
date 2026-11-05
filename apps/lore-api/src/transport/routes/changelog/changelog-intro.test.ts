import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerScope } from "../../http/bearer-scope.js";
import { changelogIntroRoute, type ChangelogLines } from "./changelog-intro.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const THURSDAY_W45 = new Date("2026-11-05T12:00:00Z");

function scene({ withFloor }: { withFloor: boolean } = { withFloor: true }) {
  const started: Array<{ line: string; key: unknown }> = [];
  const lines: ReturnType<ChangelogLines> = {
    start: (line, starting) => {
      started.push({
        line,
        key: (starting.startItems?.changelog_key as { ref: string }).ref,
      });

      return Promise.resolve({ run: { id: "run-44" }, joined: false } as never);
    },
  };
  const server = Hapi.server();

  registerBearerScope(server, () => null);
  server.route(
    changelogIntroRoute(
      () => (withFloor ? lines : null),
      () => THURSDAY_W45,
    ),
  );

  const post = async (week: string) => {
    const res = await server.inject({
      method: "POST",
      url: `/api/repos/re-cinq/lore/changelog/${week}/intro`,
      headers: AUTH,
    });

    return { status: res.statusCode, body: JSON.parse(res.payload) };
  };

  return { post, started };
}

describe("POST /api/repos/{owner}/{repo}/changelog/{week}/intro", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("starts weekly-changelog for re-cinq/lore:2026-W44 and answers 202 with run-44", async () => {
    const { post, started } = scene();

    expect({ response: await post("2026-W44"), started }).toEqual({
      response: { status: 202, body: { runId: "run-44" } },
      started: [{ line: "weekly-changelog", key: "re-cinq/lore:2026-W44" }],
    });
  });

  it("refuses the current week 2026-W45 with 400 and starts nothing", async () => {
    const { post, started } = scene();

    expect({ status: (await post("2026-W45")).status, started }).toEqual({
      status: 400,
      started: [],
    });
  });

  it("starts weekly-changelog for re-cinq/lore:999-W10, a three-digit year", async () => {
    const { post, started } = scene();

    expect({ status: (await post("999-W10")).status, started }).toEqual({
      status: 202,
      started: [{ line: "weekly-changelog", key: "re-cinq/lore:999-W10" }],
    });
  });

  it("refuses 12026-W01, a week that has not ended, with 400", async () => {
    expect((await scene().post("12026-W01")).status).toBe(400);
  });

  it("refuses week 2026-W54, past any year's last week, with 400", async () => {
    expect((await scene().post("2026-W54")).status).toBe(400);
  });

  it("refuses week yesterday with 400", async () => {
    expect((await scene().post("yesterday")).status).toBe(400);
  });

  it("answers 503 when no floor is configured", async () => {
    expect((await scene({ withFloor: false }).post("2026-W44")).status).toBe(
      503,
    );
  });
});
