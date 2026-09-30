import { describe, expect, it } from "vitest";
import {
  planRun,
  recordedPlanFloor,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { AssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs.js";
import { planEngineOf } from "./plan-engine.js";

const REPO = "re-cinq/lore";
const PLAN = { id: "p1", repo: REPO };
const FINISHED = planRun({
  outcome: "success",
  finishedAt: "2026-10-01T10:00:00.000Z",
});

async function postgresHolding(...blueprints: string[]) {
  const store = new InMemoryAssemblyRuns();

  for (const blueprintName of blueprints) {
    await store.start({
      blueprintName,
      repo: REPO,
      branch: "lore/feature-planning/faster-checkout-abcd1234",
      subjectKey: "plan:p1",
      args: {},
    });
  }

  return new AssemblyRuns(REPO, store);
}

describe("planEngineOf", () => {
  it("uses postgres on a deployment with no floor, whatever Postgres holds", async () => {
    const engine = await planEngineOf(
      { floor: null, runs: await postgresHolding() },
      PLAN,
    );

    expect(engine).toBe("postgres");
  });

  it("uses the floor for a new plan that neither store holds a run for", async () => {
    const { floor } = recordedPlanFloor({ runs: [] });

    const engine = await planEngineOf(
      { floor, runs: await postgresHolding() },
      PLAN,
    );

    expect(engine).toBe("floor");
  });

  it("uses the floor once it holds a run for plan p1, even when Postgres holds one too", async () => {
    const { floor } = recordedPlanFloor({ runs: [planRun()] });

    const engine = await planEngineOf(
      { floor, runs: await postgresHolding("feature-planning") },
      PLAN,
    );

    expect(engine).toBe("floor");
  });

  it("uses the floor for a plan whose run there finished, Postgres holding none", async () => {
    const { floor } = recordedPlanFloor({ runs: [FINISHED] });

    const engine = await planEngineOf(
      { floor, runs: await postgresHolding() },
      PLAN,
    );

    expect(engine).toBe("floor");
  });

  it("uses postgres while only Postgres holds plan p1's feature-planning run, so a running plan finishes there", async () => {
    const { floor } = recordedPlanFloor({ runs: [] });

    const engine = await planEngineOf(
      { floor, runs: await postgresHolding("feature-planning") },
      PLAN,
    );

    expect(engine).toBe("postgres");
  });

  it("ignores a Postgres run of another blueprint on the plan's subject", async () => {
    const { floor } = recordedPlanFloor({ runs: [] });

    const engine = await planEngineOf(
      { floor, runs: await postgresHolding("gap-fill") },
      PLAN,
    );

    expect(engine).toBe("floor");
  });

  it("asks the floor for one feature-planning run of github.com/re-cinq/lore on subject plan_id:p1", async () => {
    const { floor, requests } = recordedPlanFloor({ runs: [] });

    await planEngineOf({ floor, runs: await postgresHolding() }, PLAN);

    expect(requests.map((request) => request.path)).toEqual([
      "/assembly-runs?repo=github.com%2Fre-cinq%2Flore&line=feature-planning&subject=plan_id%3Ap1&limit=1",
    ]);
  });
});
