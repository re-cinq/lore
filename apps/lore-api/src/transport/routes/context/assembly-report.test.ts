import { describe, expect, it, vi } from "vitest";
import { assembledLine, reportBuilt } from "./assembly-report.js";

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

describe("reportBuilt", () => {
  it("logs backend=lore-v2 sections=builder tokens=3 for a 10-character block", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    reportBuilt(
      { backend: "lore-v2", repo: "o/r", template: undefined, query: "hi" },
      "0123456789",
      7,
    );

    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '[context] assembled backend=lore-v2 repo=o/r template=- sections=builder tokens=3 ms=7 query="hi"',
    ]);
    log.mockRestore();
  });
});
