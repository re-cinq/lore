import { describe, it, expect, afterEach, vi } from "vitest";
import { registerRunTestTool } from "./run-test.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { enterCheckout } from "./shared/test-checkout.js";

const runTest = toolHandlers(registerRunTestTool, "full")["lore_run_test"];
let leave = () => {};

afterEach(() => {
  leave();
  vi.unstubAllEnvs();
});

describe("lore_run_test", () => {
  it("returns passed true and the covered range the manifest's run command prints for selector a.test.ts", async () => {
    ({ leave } = enterCheckout({
      git: true,
      manifest: `run: "test {selector} = a.test.ts && echo '{\\"passed\\":true,\\"covered\\":[{\\"file\\":\\"a.ts\\",\\"startLine\\":1,\\"endLine\\":4}]}'"\n`,
    }));

    const result = await runTest({ selector: "a.test.ts" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      passed: true,
      covered: [{ file: "a.ts", startLine: 1, endLine: 4 }],
    });
  });

  it("refuses on the shared server, where LORE_DB_HOST is set", async () => {
    ({ leave } = enterCheckout({ git: true }));
    vi.stubEnv("LORE_DB_HOST", "lore-db");

    const result = await runTest({ selector: "a.test.ts" });

    expect(result.content[0].text).toBe(
      "Test commands run only in a trusted sandbox — run in CI or locally.",
    );
  });

  it("reports the error when the run command prints no JSON", async () => {
    ({ leave } = enterCheckout({
      git: false,
      manifest: `run: "echo nope"\n`,
    }));

    const result = await runTest({ selector: "a.test.ts" });

    expect(result.content[0].text).toBe(
      "Error: tests.run command did not emit valid JSON: nope\n",
    );
  });
});
