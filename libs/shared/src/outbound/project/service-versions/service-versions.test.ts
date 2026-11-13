import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { InMemoryServiceVersions } from "./service-versions-memory.js";
import { PgServiceVersions } from "./service-versions-pg.js";
import {
  FLOOR_CLIENT,
  readPackageVersions,
  recordServiceStart,
  serviceStart,
  withSharedFloorClient,
} from "./package-versions.js";
import type { PgPool } from "../../memory-store.js";
import type { ServiceVersion } from "../../../domain/models/service-version.js";

const apiStart: ServiceVersion = {
  service: "lore-api",
  build: "abc1234",
  packages: { zod: "4.0.0" },
  startedAt: new Date("2026-11-13T10:00:00Z"),
};

function fakePool(rows: unknown[] = []) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: rows as T[] };
    },
  };

  return { pool, calls };
}

describe("InMemoryServiceVersions", () => {
  it("keeps one row per service, the newest start winning", async () => {
    const versions = new InMemoryServiceVersions();

    await versions.record({ ...apiStart, build: "old0000" });
    await versions.record(apiStart);
    await versions.record({ ...apiStart, service: "stations" });

    expect(await versions.list()).toEqual([
      apiStart,
      { ...apiStart, service: "stations" },
    ]);
  });
});

describe("PgServiceVersions", () => {
  it("upserts a start on its service with the packages as json", async () => {
    const { pool, calls } = fakePool();

    await new PgServiceVersions(pool).record(apiStart);

    expect({ sql: calls[0]?.text, params: calls[0]?.params }).toEqual({
      sql: expect.stringContaining("ON CONFLICT (service) DO UPDATE"),
      params: ["lore-api", "abc1234", '{"zod":"4.0.0"}', apiStart.startedAt],
    });
  });

  it("lists every row as the model", async () => {
    const { pool } = fakePool([
      {
        service: "lore-api",
        build: "abc1234",
        packages: { zod: "4.0.0" },
        started_at: apiStart.startedAt,
      },
    ]);

    expect(await new PgServiceVersions(pool).list()).toEqual([apiStart]);
  });
});

describe("readPackageVersions", () => {
  it("reads zod's version from the package the caller resolves and skips a missing one", () => {
    const required = createRequire(import.meta.url);
    const zodVersion = (required("zod/package.json") as { version: string })
      .version;

    expect(
      readPackageVersions(required, ["zod", "@re-cinq/no-such-package"]),
    ).toEqual({ zod: zodVersion });
  });
});

describe("withSharedFloorClient", () => {
  const sharedFloorClient = readPackageVersions(
    createRequire(new URL("./package-versions.ts", import.meta.url)),
    [FLOOR_CLIENT],
  )[FLOOR_CLIENT];

  it("adds libs/shared's floor-client under its own key when the service resolves 0.0.1", () => {
    expect(withSharedFloorClient({ [FLOOR_CLIENT]: "0.0.1" })).toEqual({
      [FLOOR_CLIENT]: "0.0.1",
      [`${FLOOR_CLIENT} (libs/shared)`]: sharedFloorClient,
    });
  });

  it("adds nothing when the service resolves the same floor-client", () => {
    expect(
      withSharedFloorClient({ [FLOOR_CLIENT]: String(sharedFloorClient) }),
    ).toEqual({ [FLOOR_CLIENT]: sharedFloorClient });
  });
});

describe("serviceStart", () => {
  it("records the LORE_BUILD_SHA build of stations started now", () => {
    const now = new Date("2026-11-13T10:00:00Z");

    expect(
      serviceStart(
        "stations",
        { zod: "4.0.0" },
        { LORE_BUILD_SHA: "abc1234" },
        now,
      ),
    ).toEqual({
      service: "stations",
      build: "abc1234",
      packages: { zod: "4.0.0" },
      startedAt: now,
    });
  });

  it("records dev for a process built without a sha", () => {
    expect(serviceStart("stations", {}, {}).build).toBe("dev");
  });
});

describe("recordServiceStart", () => {
  it("records the start on the port", async () => {
    const versions = new InMemoryServiceVersions();

    await recordServiceStart(versions, apiStart);

    expect(await versions.list()).toEqual([apiStart]);
  });

  it("resolves when the write fails", async () => {
    const broken = {
      record: async () => {
        throw new Error("db down");
      },
      list: async () => [],
    };

    await expect(recordServiceStart(broken, apiStart)).resolves.toBe(undefined);
  });
});
