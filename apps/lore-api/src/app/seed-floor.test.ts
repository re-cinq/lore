import { describe, expect, it } from "vitest";
import { seedFloor, type FloorSeeding } from "./seed-floor.js";
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

function seeding(overrides: Partial<SeedDeps>) {
  const logged: string[] = [];
  const imported: string[] = [];
  const deps: SeedDeps = {
    files: () => Promise.resolve([{ name: "walk.yaml", text: LINE }]),
    env: {},
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
