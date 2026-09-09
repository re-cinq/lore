import { describe, expect, it } from "vitest";
import { implementationTicketDescription } from "./ticket-description.js";

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

  it("caps a 40KB body at 16000 characters and says so", () => {
    const composed = implementationTicketDescription({
      title: "Big listing",
      body: "x".repeat(40_000),
    });

    expect(composed).toHaveLength(
      "Big listing\n\n".length + 16_000 + "\n\n[issue body truncated]".length,
    );
    expect(composed.endsWith("\n\n[issue body truncated]")).toBe(true);
  });

  it("keeps a body at exactly the cap unmarked", () => {
    const composed = implementationTicketDescription({
      title: "Edge",
      body: "y".repeat(16_000),
    });

    expect(composed).toBe(`Edge\n\n${"y".repeat(16_000)}`);
  });
});
