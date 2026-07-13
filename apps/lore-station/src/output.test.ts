import { describe, it, expect } from "vitest";
import { resultLine } from "./output.js";
import { parseNodeResult } from "@re-cinq/lore-assembly-lines";

describe("resultLine", () => {
  it("emits the claude-style terminal event carrying the LORE_NODE_RESULT payload", () => {
    const line = resultLine({
      outcome: "success",
      extras: { "Lore-Validation": "passed" },
    });
    const event = JSON.parse(line);

    expect(event).toMatchObject({ type: "result", is_error: false });
    expect(event.result).toMatch(/^LORE_NODE_RESULT: /);
  });

  it("round-trips through the Floor's parseNodeResult", () => {
    const line = resultLine({
      outcome: "failed",
      extras: { "Lore-Validation-Failed": "lint" },
    });

    expect(parseNodeResult(JSON.parse(line).result)).toEqual({
      outcome: "failed",
      extras: { "Lore-Validation-Failed": "lint" },
    });
  });

  it("marks infrastructure errors is_error so the CR fails", () => {
    const line = resultLine(null, "clone exploded");

    expect(JSON.parse(line)).toEqual({
      type: "result",
      is_error: true,
      result: "clone exploded",
    });
  });
});
