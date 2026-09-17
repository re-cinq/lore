import { describe, expect, it } from "vitest";
import {
  implementationTicketDescription,
  ticketTooLarge,
} from "./ticket-description.js";

describe("implementationTicketDescription", () => {
  it("hands the pod the issue body under the title", () => {
    expect(
      implementationTicketDescription({
        title: "Broken or misplaced test links detected",
        body: "248 links across 23 specs don't resolve.",
      }),
    ).toBe(
      "Broken or misplaced test links detected\n\n248 links across 23 specs don't resolve.",
    );
  });

  it("stays title-only when the issue has no body", () => {
    expect(implementationTicketDescription({ title: "Fix the toggle" })).toBe(
      "Fix the toggle",
    );
  });

  it("stays title-only on a blank body", () => {
    expect(
      implementationTicketDescription({
        title: "Fix the toggle",
        body: "  \n",
      }),
    ).toBe("Fix the toggle");
  });

  it("keeps a 40KB body whole under the title", () => {
    expect(
      implementationTicketDescription({
        title: "Big listing",
        body: "x".repeat(40_000),
      }),
    ).toBe(`Big listing\n\n${"x".repeat(40_000)}`);
  });
});

describe("ticketTooLarge", () => {
  it("returns true when title and body compose to 32001 chars", () => {
    expect(ticketTooLarge({ title: "T", body: "x".repeat(31_998) })).toBe(true);
  });

  it("returns false when title and body compose to exactly 32000 chars", () => {
    expect(ticketTooLarge({ title: "T", body: "x".repeat(31_997) })).toBe(
      false,
    );
  });
});
