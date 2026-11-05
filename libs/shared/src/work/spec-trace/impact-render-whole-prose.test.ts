import { describe, expect, it } from "vitest";
import { wholeProse } from "./impact-render.js";

describe("wholeProse", () => {
  it("keeps all 300 characters of a statement longer than the quote limit", () => {
    expect(wholeProse("x".repeat(300))).toEqual("x".repeat(300));
  });

  it("drops a validated-by group a period follows and keeps the period", () => {
    expect(
      wholeProse("A MUST hold (#12) ([validated by `a`](x.test.ts#L1))."),
    ).toEqual("A MUST hold (#12).");
  });

  it("drops two groups a period follows and keeps one period", () => {
    expect(
      wholeProse(
        "A MUST hold (#12) ([validated by `a`](x.test.ts#L1)) ([validated by `b`](y.test.ts#L2)).",
      ),
    ).toEqual("A MUST hold (#12).");
  });

  it("keeps one period when a statement closes on a period before and after its group", () => {
    expect(
      wholeProse("A MUST hold. ([validated by `a`](x.test.ts#L1))."),
    ).toEqual("A MUST hold.");
  });

  it("closes up a period left standing apart when a group was removed", () => {
    expect(wholeProse("A MUST hold (#12) .")).toEqual("A MUST hold (#12).");
  });

  it("keeps a prose parenthetical a period follows", () => {
    expect(wholeProse("A MUST hold (on mount, not on hover).")).toEqual(
      "A MUST hold (on mount, not on hover).",
    );
  });
});
