import { describe, it, expect } from "vitest";
import { createDetectHandler, DETECT_SUMMARY_MAX_CHARS } from "./detect-handler.js";
import type { NodeContext } from "./assembly-line-executor.js";
import type { AssemblyLineNode } from "./loader.js";

const ctx: NodeContext = {
  taskId: "task-1",
  assemblyLineId: "al-1",
  branchName: "detect/spec-drift/re-cinq/lore",
  gitDir: "/tmp/nowhere",
  iteration: 0,
  assemblyLineName: "spec-drift",
};

const detectNode = (job_ref?: string): AssemblyLineNode => ({
  id: "detect",
  type: "detect",
  job_ref,
});

describe("createDetectHandler", () => {
  it("invokes the registry detector with the run's repo and returns success with the summary extra", async () => {
    const seen: string[] = [];
    const handler = createDetectHandler(
      {
        spec_drift: async ({ repo }) => {
          seen.push(repo);
          return "Checked 4 specs (1 drifted)";
        },
      },
      { repo: "re-cinq/lore" },
    );

    const result = await handler(detectNode("spec_drift"), ctx);

    expect(seen).toEqual(["re-cinq/lore"]);
    expect(result).toEqual({
      outcome: "success",
      extras: { "Lore-Detect-Summary": "Checked 4 specs (1 drifted)" },
    });
  });

  it("passes the full summary to onSummary and truncates the trailer extra", async () => {
    const long = "x".repeat(DETECT_SUMMARY_MAX_CHARS + 50);
    let captured = "";
    const handler = createDetectHandler(
      { spec_drift: async () => long },
      { repo: "re-cinq/lore", onSummary: (s) => void (captured = s) },
    );

    const result = await handler(detectNode("spec_drift"), ctx);

    expect(captured).toBe(long);
    expect(result.extras?.["Lore-Detect-Summary"]).toHaveLength(DETECT_SUMMARY_MAX_CHARS);
  });

  it("throws on a job_ref missing from the registry", async () => {
    const handler = createDetectHandler({}, { repo: "re-cinq/lore" });
    await expect(handler(detectNode("ghost_job"), ctx)).rejects.toThrow(
      new Error('detect node "detect": no detector registered for job_ref "ghost_job"'),
    );
  });

  it("throws on a detect node without job_ref", async () => {
    const handler = createDetectHandler(
      { spec_drift: async () => "ok" },
      { repo: "re-cinq/lore" },
    );
    await expect(handler(detectNode(undefined), ctx)).rejects.toThrow(
      new Error('detect node "detect": no detector registered for job_ref "undefined"'),
    );
  });

  it("propagates detector errors unchanged", async () => {
    const handler = createDetectHandler(
      {
        spec_drift: async () => {
          throw new Error("db unreachable");
        },
      },
      { repo: "re-cinq/lore" },
    );
    await expect(handler(detectNode("spec_drift"), ctx)).rejects.toThrow(
      new Error("db unreachable"),
    );
  });
});
