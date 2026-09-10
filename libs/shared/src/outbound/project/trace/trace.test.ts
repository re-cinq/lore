import { describe, it, expect } from "vitest";
import { TraceView } from "./trace.js";
import type { TracePort } from "./trace-port.js";
import type { CoveringTest } from "../../spec-trace/tests-covering.js";

interface Call {
  repo: string;
  target: { file: string; ranges?: [number, number][] };
  branch?: string;
}

function viewOver(calls: Call[], answer: CoveringTest[] = []) {
  const port = {
    testsCovering: async (
      repo: string,
      target: Call["target"],
      branch?: string,
    ) => {
      calls.push({ repo, target, branch });

      return answer;
    },
  } as unknown as TracePort;

  return new TraceView("o/r", port);
}

describe("TraceView.testsCovering", () => {
  it("binds the view's repo and forwards target plus branch to the port", async () => {
    const calls: Call[] = [];

    await viewOver(calls).testsCovering(
      { file: "src/a.ts", ranges: [[1, 9]] },
      "feat/x",
    );

    expect(calls).toEqual([
      {
        repo: "o/r",
        target: { file: "src/a.ts", ranges: [[1, 9]] },
        branch: "feat/x",
      },
    ]);
  });

  it("returns the port's covering tests unchanged when no branch narrows the read", async () => {
    const answer: CoveringTest[] = [
      { testFile: "src/a.test.ts", origin: "main" },
    ];

    const out = await viewOver([], answer).testsCovering({ file: "src/a.ts" });

    expect(out).toEqual(answer);
  });
});
