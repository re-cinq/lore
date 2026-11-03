import { describe, expect, it } from "vitest";
import { assembledLine } from "./assembly-report.js";

describe("assembledLine", () => {
  it("carries the query Otto issue 621 reproduction, quoted, after the sections", () => {
    expect(
      assembledLine(
        {
          backend: "utopia",
          repo: "re-cinq/Otto",
          template: "default",
          query: 'Otto issue 621 "reproduction"',
        },
        { sections: ["repo", "coupling"], tokens: 1520, ms: 2819 },
      ),
    ).toBe(
      '[context] assembled backend=utopia repo=re-cinq/Otto template=default sections=repo,coupling tokens=1520 ms=2819 query="Otto issue 621 \\"reproduction\\""',
    );
  });

  it("writes - for a missing repo and template", () => {
    expect(
      assembledLine(
        { backend: "lore", repo: undefined, template: undefined, query: "hi" },
        { sections: [], tokens: 0, ms: 5 },
      ),
    ).toBe(
      '[context] assembled backend=lore repo=- template=- sections= tokens=0 ms=5 query="hi"',
    );
  });
});
