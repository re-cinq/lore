import { describe, it, expect } from "vitest";
import { stripCoverageLinks } from "./spec-link-strip.js";

describe("stripCoverageLinks", () => {
  it("removes '([validated by `x.test.ts:12`](x.test.ts#L12))' and leaves 'Statement.'", () => {
    expect(
      stripCoverageLinks(
        "Statement. ([validated by `x.test.ts:12`](libs/x.test.ts#L12))",
      ),
    ).toBe("Statement.");
  });

  it("removes a two-link list with an implemented-by tail spanning 180 chars", () => {
    const group =
      "([validated by `a.test.ts:6`](libs/a.test.ts#L6), [`b.test.ts:17`](libs/b.test.ts#L17); implemented by [`c.ts:30`](libs/c.ts#L30))";

    expect(
      stripCoverageLinks(
        `- **FR1.1** Every phase ends with a commit. ${group}\n- next`,
      ),
    ).toBe("- **FR1.1** Every phase ends with a commit.\n- next");
  });

  it("removes a bare '([implemented by …])' group and a titled '[validated by title](…)' link alike", () => {
    expect(
      stripCoverageLinks(
        "One. ([implemented by `s.ts:122`](libs/s.ts#L122)) Two. ([validated by posts the whole EventInsert](libs/e.test.ts#L20))",
      ),
    ).toBe("One. Two.");
  });

  it("leaves prose with an ordinary markdown link untouched", () => {
    const prose =
      "See [the runbook](runbooks/x.md) for details (not a link group).";

    expect(stripCoverageLinks(prose)).toBe(prose);
  });
});
