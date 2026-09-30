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

function seeding(overrides: Partial<SeedDeps>) {
  const logged: string[] = [];
  const imported: string[] = [];
  const deps: SeedDeps = {
    files: () => Promise.resolve([{ name: "walk.yaml", text: LINE }]),
    env: {},
    lineExists: async () => false,
    importPipeline: (pipeline) => {
      imported.push(pipeline.line?.id ?? "");

      return Promise.resolve();
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
  it("imports the line walk and logs it when the floor has none", async () => {
    const { floorSeeding, logged, imported } = seeding({});

    await seedFloor(floorSeeding);

    expect({ logged, imported }).toEqual({
      logged: ["floor pipelines seeded: walk"],
      imported: ["walk"],
    });
  });

  it("logs none missing when the floor already has the line walk", async () => {
    const { floorSeeding, logged } = seeding({
      lineExists: async () => true,
    });

    await seedFloor(floorSeeding);

    expect(logged).toEqual(["floor pipelines seeded: none missing"]);
  });

  it("logs the failure and does not throw when the floor is out of reach", async () => {
    const { floorSeeding, logged } = seeding({
      lineExists: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });

    await seedFloor(floorSeeding);

    expect(logged).toEqual([
      "floor pipeline seed FAILED — the floor keeps the lines it has:",
    ]);
  });

  it("reads no file on a deployment with no floor configured", async () => {
    const { floorSeeding, logged, imported } = seeding({});

    await seedFloor({ ...floorSeeding, configured: () => false });

    expect({ logged, imported }).toEqual({ logged: [], imported: [] });
  });
});
