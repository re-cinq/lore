import { describe, it, expect } from "vitest";
import { splitNodeResult } from "./node-result-line";

const TDD_RESULT =
  'LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Tdd-Done":"Green: protocol.ts","Lore-Tdd-Next":"socket/UI facets"}}';

describe("splitNodeResult", () => {
  it("lifts the LORE_NODE_RESULT line out of the prose into its outcome and extras", () => {
    expect(splitNodeResult(`Round summary.\n\n${TDD_RESULT}`)).toEqual({
      prose: "Round summary.",
      nodeResult: {
        valid: true,
        outcome: "success",
        extras: {
          "Lore-Tdd-Done": "Green: protocol.ts",
          "Lore-Tdd-Next": "socket/UI facets",
        },
      },
    });
  });

  it("returns the text untouched with no node result when no line starts with the marker", () => {
    const text = "I will print `LORE_NODE_RESULT: success` when done.";

    expect(splitNodeResult(text)).toEqual({ prose: text, nodeResult: null });
  });

  it("reads the last marker line and leaves an earlier one in the prose", () => {
    const text =
      "LORE_NODE_RESULT: failed\nOn reflection it passes.\nLORE_NODE_RESULT: success";

    expect(splitNodeResult(text)).toEqual({
      prose: "LORE_NODE_RESULT: failed\nOn reflection it passes.",
      nodeResult: { valid: true, outcome: "success", extras: {} },
    });
  });

  it("reads the legacy bare-word payload 'changes_requested' as an outcome with no extras", () => {
    expect(splitNodeResult("LORE_NODE_RESULT: changes_requested")).toEqual({
      prose: "",
      nodeResult: { valid: true, outcome: "changes_requested", extras: {} },
    });
  });

  it("drops extras whose value is not a string, as the station contract does", () => {
    expect(
      splitNodeResult(
        'LORE_NODE_RESULT: {"outcome":"failed","extras":{"reason":"red","count":3}}',
      ).nodeResult,
    ).toEqual({ valid: true, outcome: "failed", extras: { reason: "red" } });
  });

  it("marks a payload with an unknown outcome as unparseable, keeping the payload", () => {
    expect(
      splitNodeResult('LORE_NODE_RESULT: {"outcome":"done"}').nodeResult,
    ).toEqual({ valid: false, payload: '{"outcome":"done"}' });
  });

  it("marks a payload that is not JSON as unparseable, keeping the payload", () => {
    expect(splitNodeResult("LORE_NODE_RESULT: {oops").nodeResult).toEqual({
      valid: false,
      payload: "{oops",
    });
  });
});
