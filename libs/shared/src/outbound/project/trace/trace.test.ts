import { describe, it, expect } from "vitest";
import { TraceView } from "./trace.js";
import type { TracePort } from "./trace-port.js";
import type { CoveringTest } from "../../spec-trace/tests-covering.js";

interface Call {
  repo: string;
  target: { file: string; ranges?: [number, number][] };
  assemblyRunId?: string;
}

function viewOver(calls: Call[], answer: CoveringTest[] = []) {
  const port = {
    testsCovering: async (
      repo: string,
      target: Call["target"],
      assemblyRunId?: string,
    ) => {
      calls.push({ repo, target, assemblyRunId });

      return answer;
    },
  } as unknown as TracePort;

  return new TraceView("o/r", port);
}

describe("TraceView.testsCovering", () => {
  it("binds the view's repo and forwards target plus run id to the port", async () => {
    const calls: Call[] = [];

    await viewOver(calls).testsCovering(
      { file: "src/a.ts", ranges: [[1, 9]] },
      "run-7",
    );

    expect(calls).toEqual([
      {
        repo: "o/r",
        target: { file: "src/a.ts", ranges: [[1, 9]] },
        assemblyRunId: "run-7",
      },
    ]);
  });

  it("returns the port's covering tests unchanged when no run id narrows the read", async () => {
    const answer: CoveringTest[] = [
      { testFile: "src/a.test.ts", origin: "main" },
    ];

    const out = await viewOver([], answer).testsCovering({ file: "src/a.ts" });

    expect(out).toEqual(answer);
  });
});
