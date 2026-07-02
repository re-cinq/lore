import { describe, it, expect, afterEach } from "vitest";
import { Llm } from "./llm/llm.js";
import { FakeLlm } from "./llm/fake-llm.js";
import { extractAssertions } from "./spec-judge-llm.js";

afterEach(() => Llm.reset());

describe("extractAssertions", () => {
  it("returns the assertions the model tool call produced", async () => {
    Llm.setInstance(
      new FakeLlm({
        data: { assertions: [{ name: "parseTasks", kind: "function", description: "parses tasks.md" }] },
      }),
    );
    const out = await extractAssertions("spec body", "specs/x/spec.md", { jobName: "spec_drift" });
    expect(out).toEqual([{ name: "parseTasks", kind: "function", description: "parses tasks.md" }]);
  });

  it("propagates the caller's jobName to the LLM call (cost accounting)", async () => {
    const fake = new FakeLlm({ data: { assertions: [] } });
    Llm.setInstance(fake);
    await extractAssertions("body", "specs/y/spec.md", { jobName: "spec_coverage_backfill" });
    expect(fake.calls[0].jobName).toBe("spec_coverage_backfill");
  });

  it("returns [] when the model yields no assertions field", async () => {
    Llm.setInstance(new FakeLlm({ data: {} }));
    expect(await extractAssertions("body", "f", { jobName: "spec_drift" })).toEqual([]);
  });
});
