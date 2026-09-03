import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHARED = resolve(
  process.cwd(),
  "../../libs/shared/src/test-command-setup-prompt.ts",
);
const MIRROR = resolve(process.cwd(), "src/lib/test-command-setup-prompt.ts");

const exportBlock = (file: string): string => {
  const text = readFileSync(file, "utf8");
  const at = text.indexOf("export const TEST_COMMAND_SETUP_PROMPT");

  return text.slice(at);
};

describe("test-command-setup-prompt mirror", () => {
  it("exports a byte-identical constant to the shared source", () => {
    expect(exportBlock(MIRROR)).toEqual(exportBlock(SHARED));
  });
});
