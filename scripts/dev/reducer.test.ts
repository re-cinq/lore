import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce } from "./reducer.ts";
import { servicesFor } from "./services.ts";
import { resolveMode } from "./mode.ts";

const localState = initialState(
  servicesFor({
    mode: resolveMode({}),
    root: "/work/lore",
    env: {},
    floor: null,
    floorNote: "",
  }),
);
const lastRow = localState.rows.length - 1;

describe("reduce", () => {
  it("wraps to the first row when selecting down from the last row", () => {
    const atLastRow = { ...localState, selected: lastRow };

    assert.equal(reduce(atLastRow, { type: "select", delta: 1 }).selected, 0);
  });

  it("wraps to the last row when selecting up from the first row", () => {
    assert.equal(
      reduce(localState, { type: "select", delta: -1 }).selected,
      lastRow,
    );
  });

  it("toggles between selected and all log modes with a", () => {
    const allMode = reduce(localState, { type: "toggleAll" });
    const backToSelected = reduce(allMode, { type: "toggleAll" });

    assert.deepEqual(
      [allMode.logMode, backToSelected.logMode],
      ["all", "selected"],
    );
  });

  it("returns to the selected service's log with showSelected", () => {
    const allMode = reduce(localState, { type: "toggleAll" });

    assert.equal(reduce(allMode, { type: "showSelected" }).logMode, "selected");
  });

  it("ignores a line for an unknown service", () => {
    assert.equal(
      reduce(localState, { type: "line", service: "nope", text: "hi" }),
      localState,
    );
  });

  it("keeps a line for a known service in its own and the merged log", () => {
    const next = reduce(localState, {
      type: "line",
      service: "api",
      text: "listening",
    });

    assert.deepEqual(
      [next.linesByService, next.allLines],
      [{ api: ["listening"] }, [{ service: "api", text: "listening" }]],
    );
  });

  it("keeps only the newest 500 lines of a service", () => {
    const flooded = Array.from({ length: 501 }, (_, index) => index).reduce(
      (state, index) =>
        reduce(state, { type: "line", service: "api", text: `line ${index}` }),
      localState,
    );
    const apiLines = flooded.linesByService.api;

    assert.deepEqual([apiLines.length, apiLines[0]], [500, "line 1"]);
  });

  it("sets crashed (1) when a service exits with code 1", () => {
    const next = reduce(localState, { type: "exit", service: "api", code: 1 });

    assert.deepEqual(next.rows.find((row) => row.name === "api")?.status, {
      text: "crashed (1)",
      tone: "bad",
    });
  });

  it("keeps the last lines of a crashed service", () => {
    const withLine = reduce(localState, {
      type: "line",
      service: "api",
      text: "boom",
    });
    const crashed = reduce(withLine, { type: "exit", service: "api", code: 1 });

    assert.deepEqual(crashed.linesByService.api, ["boom"]);
  });

  it("sets the status of a known row", () => {
    const next = reduce(localState, {
      type: "status",
      name: "ui",
      status: { text: "healthy", tone: "ok" },
    });

    assert.equal(
      next.rows.find((row) => row.name === "ui")?.status.text,
      "healthy",
    );
  });
});
