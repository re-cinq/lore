import { describe, it, expect } from "vitest";
import { resolveTestLines } from "./resolve-test-lines.js";
import type { TestDescriptor } from "../test-report.js";

// Line map: 4 = it("greets…"), 8 = it("farewells…"), 12 = it.skip("naps…").
const FILE = `import { describe, it } from "vitest";

describe("greeter", () => {
  it("greets the user", () => {
    expect(greet()).toBe("hi");
  });

  it("farewells the user", () => {
    expect(bye()).toBe("bye");
  });

  it.skip("naps", () => {
    expect(nap()).toBe("zzz");
  });
});
`;

const desc = (leaf: string): TestDescriptor => ({ id: `f::${leaf}`, name: `greeter > ${leaf}`, file: "f.test.ts" });

describe("resolveTestLines", () => {
  it("attaches each it-declaration line as startLine and the next declaration minus one as endLine", () => {
    const [greets, farewells] = resolveTestLines(FILE, [desc("greets the user"), desc("farewells the user")]);

    expect(greets).toMatchObject({ startLine: 4, endLine: 7 });
    expect(farewells).toMatchObject({ startLine: 8, endLine: 11 });
  });

  it("resolves it.skip / it.only modifiers and spans the last test to end of file", () => {
    const [naps] = resolveTestLines(FILE, [desc("naps")]);

    expect(naps.startLine).toBe(12);
    expect(naps.endLine).toBeGreaterThanOrEqual(15);
  });

  it("leaves a descriptor whose leaf name matches no declaration unchanged", () => {
    const [missing] = resolveTestLines(FILE, [desc("does not exist")]);

    expect(missing.startLine).toBeUndefined();
    expect(missing.endLine).toBeUndefined();
  });
});
