import { describe, it, expect } from "vitest";
import { mirrorMoveOutcome, outcomeLines } from "./mirror-move-outcome";

const preview = {
  mirror: "acme/public",
  dry_run: true,
  tables: [
    { table: "memories", moved: 4, kept_conflict: 1 },
    { table: "facts", moved: 0, kept_conflict: 0 },
    { table: "episodes", moved: 0, kept_conflict: 2 },
  ],
  cancelled_runs: [],
  mirror_row_deleted: false,
};

describe("mirrorMoveOutcome", () => {
  it("hides the facts table where both numbers are 0 and totals 4 moved", () => {
    expect(mirrorMoveOutcome({ status: "ok", data: preview })).toEqual({
      ok: true,
      summary: {
        mirror: "acme/public",
        dryRun: true,
        tables: [
          { table: "memories", moved: 4, keptConflict: 1 },
          { table: "episodes", moved: 0, keptConflict: 2 },
        ],
        totalMoved: 4,
        nothingToMove: false,
        cancelledRuns: 0,
        variableNote: null,
        rowDeleted: false,
      },
    });
  });

  it("reports nothing to move when every table holds 0 and 0", () => {
    expect(
      mirrorMoveOutcome({
        status: "ok",
        data: {
          ...preview,
          tables: [{ table: "facts", moved: 0, kept_conflict: 0 }],
        },
      }),
    ).toMatchObject({
      summary: { tables: [], totalMoved: 0, nothingToMove: true },
    });
  });

  it("counts 2 cancelled runs and notes the variable was set", () => {
    expect(
      mirrorMoveOutcome({
        status: "ok",
        data: {
          ...preview,
          dry_run: false,
          cancelled_runs: ["run-1", "run-2"],
          mirror_variable: { set: true },
          mirror_row_deleted: true,
        },
      }),
    ).toMatchObject({
      summary: {
        cancelledRuns: 2,
        variableNote: "LORE_MIRROR was set on acme/public",
        rowDeleted: true,
      },
    });
  });

  it("gives the reason when the variable was not set", () => {
    expect(
      mirrorMoveOutcome({
        status: "ok",
        data: {
          ...preview,
          mirror_variable: { set: false, reason: "no admin on the repository" },
        },
      }),
    ).toMatchObject({
      summary: {
        variableNote:
          "LORE_MIRROR was not set on acme/public: no admin on the repository",
      },
    });
  });

  it("says the repository has no mirror for a 409", () => {
    expect(
      mirrorMoveOutcome({ status: "error", message: "HTTP 409", code: 409 }),
    ).toEqual({
      ok: false,
      said: "Could not move the mirror's knowledge: this repository has no public mirror saved.",
    });
  });

  it("says only an admin can move it for a 403", () => {
    expect(
      mirrorMoveOutcome({ status: "error", message: "forbidden", code: 403 }),
    ).toEqual({
      ok: false,
      said: "Could not move the mirror's knowledge: only an admin can move it.",
    });
  });

  it("names lore-api's message for a 400", () => {
    expect(
      mirrorMoveOutcome({
        status: "error",
        message: "confirm must be acme/public",
        code: 400,
      }),
    ).toEqual({
      ok: false,
      said: "Could not move the mirror's knowledge: confirm must be acme/public.",
    });
  });

  it("says the Lore API is unconfigured without a session", () => {
    expect(mirrorMoveOutcome({ status: "unconfigured" })).toEqual({
      ok: false,
      said: "Could not move the mirror's knowledge: Lore API unconfigured.",
    });
  });
});

describe("mirrorMoveOutcome without a reason", () => {
  it("says LORE_MIRROR was not set on acme/public: no reason given when set is false and no reason came", () => {
    const outcome = mirrorMoveOutcome({
      status: "ok",
      data: { ...preview, mirror_variable: { set: false } },
    });

    expect(outcome.ok && outcome.summary.variableNote).toEqual(
      "LORE_MIRROR was not set on acme/public: no reason given",
    );
  });
});

describe("outcomeLines", () => {
  it("lists 4 moved, 2 runs cancelled, the variable and the removed row", () => {
    expect(
      outcomeLines({
        mirror: "acme/public",
        dryRun: false,
        tables: [],
        totalMoved: 4,
        nothingToMove: false,
        cancelledRuns: 2,
        variableNote: "LORE_MIRROR was set on acme/public",
        rowDeleted: true,
      }),
    ).toEqual([
      "4 rows moved to this repository.",
      "2 runs cancelled.",
      "LORE_MIRROR was set on acme/public.",
      "The mirror's row was removed.",
    ]);
  });

  it("says 1 run and keeps the row when it was not deleted and no variable was touched", () => {
    expect(
      outcomeLines({
        mirror: "acme/public",
        dryRun: false,
        tables: [],
        totalMoved: 1,
        nothingToMove: false,
        cancelledRuns: 1,
        variableNote: null,
        rowDeleted: false,
      }),
    ).toEqual([
      "1 row moved to this repository.",
      "1 run cancelled.",
      "The mirror's row was kept.",
    ]);
  });
});
