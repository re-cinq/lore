import { test, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";

test("agent-image has gh CLI installed. ([validated by agent-image has gh CLI installed](apps/agent-image/agent-image.acceptance.test.ts#L5))", () => {
  const contextDir = join(__dirname);

  execSync(`docker build -t test-agent-image ${contextDir}`, {
    stdio: "ignore",
  });
  const output = execSync("docker run --rm test-agent-image gh --version", {
    encoding: "utf-8",
  });

  expect(output).toMatch(/gh version/i);
}, 120000);
