import { describe, it, expect } from "vitest";
import { TestSuite } from "./test-suite.js";
import type { TestRunnerPort } from "./test-runner-port.js";
import type { TestDescriptor } from "../../test-report.js";

/**
 * The trust boundary. With LORE_DB_HOST set (the shared GKE server) the facade
 * refuses before touching the runner; in a sandbox it delegates. Real env
 * values drive the gate — no mocks.
 */

const descriptors: TestDescriptor[] = [
  { id: "t1", name: "adds two numbers", file: "src/add.test.ts", startLine: 1, endLine: 3 },
];

function fakeRunner(): TestRunnerPort {
  return {
    listTests: async () => descriptors,
    runTest: async () => ({ passed: true, covered: [] }),
    report: async () => ({ passed: 1, failed: 0, results: [] }),
  };
}

describe("TestSuite trust gate", () => {
  it("refuses to list tests on the shared server (LORE_DB_HOST set)", async () => {
    const suite = new TestSuite(fakeRunner(), { LORE_DB_HOST: "lore-db.internal" });

    await expect(suite.listTests(".")).rejects.toThrow(
      new Error("Test commands run only in a trusted sandbox — run in CI or locally."),
    );
  });

  it("lists tests in a trusted sandbox (no LORE_DB_HOST)", async () => {
    const suite = new TestSuite(fakeRunner(), {});

    expect(await suite.listTests(".")).toEqual(descriptors);
  });
});
