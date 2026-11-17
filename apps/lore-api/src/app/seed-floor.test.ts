import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { seedFloor, syncPackAtBoot, type FloorSeeding } from "./seed-floor.js";
import type { PackSyncResult } from "../work/pack/sync-pack.js";
import type { SeedDeps } from "../work/floor/seed-floor-pipelines.js";

const LINE = `line:
  id: walk
  entry: only
  exit: only
  args: {}
  nodes:
    - id: only
  edges: []
`;

const UNCHANGED = false;

function seeding(
  overrides: Partial<SeedDeps>,
  pack: FloorSeeding["pack"] = () =>
    Promise.resolve({ status: "unconfigured" }),
) {
  const logged: string[] = [];
  const imported: string[] = [];
  const deps: SeedDeps = {
    files: () => Promise.resolve([{ name: "walk.yaml", text: LINE }]),
    env: {},
    heldAgentDefinitions: () => Promise.resolve([]),
    importPipeline: (pipeline) => {
      const id = pipeline.line?.id ?? "";

      imported.push(id);

      return Promise.resolve([{ kind: "assembly-lines", id, changed: true }]);
    },
    ...overrides,
  };
  const floorSeeding: FloorSeeding = {
    configured: () => true,
    deps: () => deps,
    pack,
    log: (message) => logged.push(message),
  };

  return { floorSeeding, logged, imported };
}

describe("seedFloor", () => {
  it("puts the line walk and logs it as changed on a floor that did not hold it", async () => {
    const { floorSeeding, logged, imported } = seeding({});

    await seedFloor(floorSeeding);

    expect({ logged, imported }).toEqual({
      logged: ["floor pipelines put: assembly-lines/walk"],
      imported: ["walk"],
    });
  });

  it("logs none changed when the floor holds the line walk as written", async () => {
    const { floorSeeding, logged } = seeding({
      importPipeline: () =>
        Promise.resolve([
          { kind: "assembly-lines", id: "walk", changed: UNCHANGED },
        ]),
    });

    await seedFloor(floorSeeding);

    expect(logged).toEqual(["floor pipelines put: none changed"]);
  });

  it("names walk.yaml and the floor's reason when the floor refuses it", async () => {
    const { floorSeeding, logged } = seeding({
      importPipeline: () => Promise.reject(new Error("invalid station body")),
    });

    await seedFloor(floorSeeding);

    expect(logged).toEqual([
      "floor pipelines put: none changed",
      "floor REFUSED, and keeps what it holds for: walk.yaml (invalid station body)",
    ]);
  });

  it("logs the failure and does not throw when reading the files throws", async () => {
    const { floorSeeding, logged } = seeding({
      files: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });

    await seedFloor(floorSeeding);

    expect(logged).toEqual([
      "floor pipeline put FAILED — the floor keeps what it holds:",
    ]);
  });

  it("reads no file on a deployment with no floor configured", async () => {
    const { floorSeeding, logged, imported } = seeding({});

    await seedFloor({ ...floorSeeding, configured: () => false });

    expect({ logged, imported }).toEqual({ logged: [], imported: [] });
  });
});

describe("syncPackAtBoot", () => {
  const POOL = {} as Pool;
  const APPLIED: PackSyncResult = {
    status: "applied",
    commit: "a1b2c3d",
    changed: ["triager"],
  };

  it("logs the commit and the agents it changed when the pack applies", async () => {
    const { floorSeeding, logged } = seeding({}, () =>
      Promise.resolve(APPLIED),
    );

    await syncPackAtBoot(POOL, floorSeeding);

    expect(logged).toEqual(["pack a1b2c3d applied: triager"]);
  });

  it("logs nothing on a deployment with no pack repo", async () => {
    const { floorSeeding, logged } = seeding({});

    await syncPackAtBoot(POOL, floorSeeding);

    expect(logged).toEqual([]);
  });

  it("logs the lease holder's skip as another replica applying", async () => {
    const { floorSeeding, logged } = seeding({}, () =>
      Promise.resolve({ skipped: "lease held" }),
    );

    await syncPackAtBoot(POOL, floorSeeding);

    expect(logged).toEqual([
      "pack sync skipped: another replica holds the lease",
    ]);
  });

  it("logs the failure the pack recorded without throwing", async () => {
    const { floorSeeding, logged } = seeding({}, () =>
      Promise.resolve({ status: "failed", error: "404 acme/lore-pack" }),
    );

    await syncPackAtBoot(POOL, floorSeeding);

    expect(logged).toEqual([
      "pack sync FAILED, the floor keeps what it holds: 404 acme/lore-pack",
    ]);
  });

  it("logs a thrown sync and does not throw", async () => {
    const { floorSeeding, logged } = seeding({}, () =>
      Promise.reject(new Error("lease table missing")),
    );

    await syncPackAtBoot(POOL, floorSeeding);

    expect(logged).toEqual([
      "pack sync crashed — the floor keeps what it holds:",
    ]);
  });

  it("does not sync the pack on a deployment with no floor configured", async () => {
    const { floorSeeding, logged } = seeding({}, () =>
      Promise.resolve(APPLIED),
    );

    await syncPackAtBoot(POOL, { ...floorSeeding, configured: () => false });

    expect(logged).toEqual([]);
  });
});
