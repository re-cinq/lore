import { describe, it, expect, afterEach, vi } from "vitest";
import { registerListTestsTool } from "./list-tests.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { enterCheckout } from "./shared/test-checkout.js";

const listTests = toolHandlers(registerListTestsTool, "full")[
  "lore_list_tests"
];
let leave = () => {};

afterEach(() => {
  leave();
  vi.unstubAllEnvs();
});

describe("lore_list_tests", () => {
  it("returns the descriptors the manifest's list command prints, in a git checkout", async () => {
    ({ leave } = enterCheckout({
      git: true,
      manifest: `list: "echo '[{\\"id\\":\\"a.test.ts > adds\\",\\"name\\":\\"adds\\",\\"file\\":\\"a.test.ts\\"}]'"\nrun: "echo {selector}"\n`,
    }));

    const result = await listTests({});

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      results: [{ id: "a.test.ts > adds", name: "adds", file: "a.test.ts" }],
    });
  });

  it("reads the manifest from the working directory when it is not a git checkout", async () => {
    ({ leave } = enterCheckout({
      git: false,
      manifest: `list: "echo '[]'"\nrun: "echo {selector}"\n`,
    }));

    const result = await listTests({});

    expect(result.content[0].text).toBe('{"results":[]}');
  });

  it("reports no manifest when the checkout has no .lore/test-commands.yml", async () => {
    ({ leave } = enterCheckout({ git: true }));

    const result = await listTests({});

    expect(result.content[0].text).toBe(
      "No test-command manifest declared for this repo.",
    );
  });

  it("refuses on the shared server, where LORE_DB_HOST is set", async () => {
    ({ leave } = enterCheckout({ git: true }));
    vi.stubEnv("LORE_DB_HOST", "lore-db");

    const result = await listTests({});

    expect(result.content[0].text).toBe(
      "Test commands run only in a trusted sandbox — run in CI or locally.",
    );
  });

  it("reports the error when the list command prints no JSON", async () => {
    ({ leave } = enterCheckout({
      git: true,
      manifest: `list: "echo nope"\nrun: "echo {selector}"\n`,
    }));

    const result = await listTests({});

    expect(result.content[0].text).toBe(
      "Error: tests.list command did not emit valid JSON: nope\n",
    );
  });
});
