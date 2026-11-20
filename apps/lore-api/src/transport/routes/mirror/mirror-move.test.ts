import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { registerBearerScope } from "../../http/bearer-scope.js";
import {
  mirrorMoveRoute,
  mirrorMoveSeams,
  type MirrorMoveFloor,
} from "./mirror-move.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const PRIVATE = "acme/private";
const MIRROR = "acme/public";
const PRIVATE_SETTINGS = {
  public_mirror: MIRROR,
  release: { schedule: "weekly" },
};

class RefusingVariableSettings extends InMemorySettings {
  override setRepoVariable(): Promise<void> {
    return Promise.reject(new Error("Resource not accessible by integration"));
  }
}

type OpenRun = Awaited<
  ReturnType<MirrorMoveFloor["runs"]["list"]>
>["items"][number];

interface SceneOptions {
  withFloor: boolean;
  variableRefused: boolean;
  privateSettings: Record<string, unknown>;
  tokenPool: Pool | null;
}

const DEFAULT_SCENE: SceneOptions = {
  withFloor: true,
  variableRefused: false,
  privateSettings: PRIVATE_SETTINGS,
  tokenPool: null,
};

function scene(options: Partial<SceneOptions> = {}) {
  const { withFloor, variableRefused, privateSettings, tokenPool } = {
    ...DEFAULT_SCENE,
    ...options,
  };
  const repos = [
    { full_name: PRIVATE, settings: privateSettings },
    {
      full_name: MIRROR,
      settings: { slack_channel_id: "C99", release: { schedule: "daily" } },
    },
  ];
  const settings = variableRefused
    ? new RefusingVariableSettings(repos)
    : new InMemorySettings(repos);
  const { floor, cancelled, listed } = floorWithOpenRuns();

  settings.knowledge.seed("lore.changelog_weeks", MIRROR, "W1");
  settings.knowledge.seed("lore.changelog_weeks", MIRROR, "W2");
  settings.knowledge.seed("lore.changelog_weeks", PRIVATE, "W2");

  const post = poster(settings, withFloor ? floor : null, tokenPool);

  return { post, settings, cancelled, listed };
}

function poster(
  settings: InMemorySettings,
  floor: MirrorMoveFloor | null,
  tokenPool: Pool | null,
) {
  const server = Hapi.server();

  registerBearerScope(server, () => tokenPool);
  server.route(
    mirrorMoveRoute(() => null, {
      settings: () => settings,
      floor: () => floor,
    }),
  );

  return async (
    payload: unknown,
    headers: Record<string, string> = AUTH,
    named: string = PRIVATE,
  ) => {
    const res = await server.inject({
      method: "POST",
      url: `/api/repos/${named}/mirror/move`,
      headers,
      payload: payload as object,
    });

    return { status: res.statusCode, body: JSON.parse(res.payload) };
  };
}

function floorWithOpenRuns() {
  const cancelled: Array<{ id: string; reason: string }> = [];
  const listed: Array<Record<string, unknown>> = [];
  const floor: MirrorMoveFloor = {
    runs: {
      list: (filter) => {
        listed.push(filter);

        return Promise.resolve({
          items: [{ id: "run-1" }, { id: "run-2" }] as OpenRun[],
          nextCursor: null,
        });
      },
      cancel: (id, reason) => {
        cancelled.push({ id, reason });

        return Promise.resolve({ id } as OpenRun);
      },
    },
  };

  return { floor, cancelled, listed };
}

const WEEKS = { table: "lore.changelog_weeks", moved: 1, kept_conflict: 1 };

describe("POST /api/repos/{owner}/{repo}/mirror/move", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers 409 for acme/private, which names no public mirror, and moves nothing", async () => {
    const { post, settings, cancelled } = scene({
      privateSettings: { release: { schedule: "weekly" } },
    });

    expect({
      status: (await post({ confirm: MIRROR })).status,
      rowsUnderMirror: settings.knowledge.rowsOf(
        "lore.changelog_weeks",
        MIRROR,
      ),
      cancelled,
      vars: settings.vars,
    }).toEqual({
      status: 409,
      rowsUnderMirror: ["W1", "W2"],
      cancelled: [],
      vars: [],
    });
  });

  it("answers 200 with the changelog week it would move for a dry run without confirm, and changes nothing", async () => {
    const { post, settings, cancelled } = scene();
    const { status, body } = await post({ dry_run: true });

    expect({
      status,
      weeks: body.tables.find(
        (count: { table: string }) => count.table === WEEKS.table,
      ),
      dry_run: body.dry_run,
      cancelled,
      vars: settings.vars,
      mirrorRowKept: (await settings.record(MIRROR)) !== null,
      rowsUnderMirror: settings.knowledge.rowsOf(
        "lore.changelog_weeks",
        MIRROR,
      ),
    }).toEqual({
      status: 200,
      weeks: WEEKS,
      dry_run: true,
      cancelled: [],
      vars: [],
      mirrorRowKept: true,
      rowsUnderMirror: ["W1", "W2"],
    });
  });

  it("answers 400 for a real run whose confirm is acme/publik instead of acme/public, and moves nothing", async () => {
    const { post, settings, cancelled } = scene();

    expect({
      status: (await post({ confirm: "acme/publik" })).status,
      rowsUnderMirror: settings.knowledge.rowsOf(
        "lore.changelog_weeks",
        MIRROR,
      ),
      cancelled,
      vars: settings.vars,
    }).toEqual({
      status: 400,
      rowsUnderMirror: ["W1", "W2"],
      cancelled: [],
      vars: [],
    });
  });

  it("cancels run-1 and run-2 of acme/public, moves 1 week, sets LORE_MIRROR on acme/public, deletes its row and keeps the private release schedule", async () => {
    const { post, settings, cancelled, listed } = scene();
    const { status, body } = await post({ confirm: MIRROR });

    expect({
      status,
      body,
      listed,
      cancelled,
      vars: settings.vars,
      mirrorRow: await settings.record(MIRROR),
      privateSettings: await settings.rawSettings(PRIVATE),
    }).toEqual({
      status: 200,
      body: {
        mirror: MIRROR,
        dry_run: false,
        tables: expect.arrayContaining([WEEKS]),
        cancelled_runs: ["run-1", "run-2"],
        mirror_variable: { set: true },
        mirror_row_deleted: true,
      },
      listed: [{ repo: "github.com/acme/public", open: true }],
      cancelled: [
        { id: "run-1", reason: "mirror-moved" },
        { id: "run-2", reason: "mirror-moved" },
      ],
      vars: [{ repo: MIRROR, name: "LORE_MIRROR", value: "true" }],
      mirrorRow: null,
      privateSettings: {
        public_mirror: MIRROR,
        release: { schedule: "weekly" },
        slack_channel_id: "C99",
      },
    });
  });

  it("skips cancelling runs when no floor is configured and still moves the week", async () => {
    const { post, cancelled } = scene({ withFloor: false });
    const { status, body } = await post({ confirm: MIRROR });

    expect({ status, cancelled_runs: body.cancelled_runs, cancelled }).toEqual({
      status: 200,
      cancelled_runs: [],
      cancelled: [],
    });
  });

  it("reports the refused LORE_MIRROR write as set false and still deletes the acme/public row", async () => {
    const { post, settings } = scene({ variableRefused: true });
    const { status, body } = await post({ confirm: MIRROR });

    expect({
      status,
      variable: body.mirror_variable,
      mirrorRow: await settings.record(MIRROR),
      weeksUnderMirror: settings.knowledge.rowsOf(
        "lore.changelog_weeks",
        MIRROR,
      ),
    }).toEqual({
      status: 200,
      variable: {
        set: false,
        reason: "Resource not accessible by integration",
      },
      mirrorRow: null,
      weeksUnderMirror: ["W2"],
    });
  });

  it("refuses a token with the write scope but not admin with 403 and moves nothing", async () => {
    const writeOnlyPool = {
      query: () =>
        Promise.resolve({
          rows: [{ scopes: ["write"], kind: "client", login: null }],
        }),
    } as unknown as Pool;
    const { settings, post, cancelled } = scene({
      tokenPool: writeOnlyPool,
    });

    expect({
      status: (
        await post(
          { confirm: MIRROR },
          { authorization: "Bearer a-write-token" },
        )
      ).status,
      rowsUnderMirror: settings.knowledge.rowsOf(
        "lore.changelog_weeks",
        MIRROR,
      ),
      cancelled,
      vars: settings.vars,
    }).toEqual({
      status: 403,
      rowsUnderMirror: ["W1", "W2"],
      cancelled: [],
      vars: [],
    });
  });

  it("counts the dry run of POST /api/repos/ACME/Private/mirror/move under acme/private, the name the repository is stored by", async () => {
    const { post } = scene();
    const { status, body } = await post(
      { dry_run: true },
      AUTH,
      "ACME/Private",
    );

    expect({
      status,
      mirror: body.mirror,
      weeks: body.tables.find(
        (count: { table: string }) => count.table === WEEKS.table,
      ),
    }).toEqual({ status: 200, mirror: MIRROR, weeks: WEEKS });
  });
});

describe("the move route's production seams", () => {
  it("set LORE_MIRROR on acme/public through the GitHub writer they were built with", async () => {
    const written: string[][] = [];
    const writer = {
      setRepoVariable: async (...call: string[]) => void written.push(call),
    };
    const seams = mirrorMoveSeams(
      () => ({}) as Pool,
      () => writer as never,
    );

    await seams.settings()?.setRepoVariable(MIRROR, "LORE_MIRROR", "true");

    expect(written).toEqual([[MIRROR, "LORE_MIRROR", "true"]]);
  });
});
