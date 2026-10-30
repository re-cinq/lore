import { describe, it, expect } from "vitest";
import { resolveTestLines } from "./resolve-test-lines.js";
import type { TestDescriptor } from "../../domain/test-report.js";

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

const desc = (leaf: string): TestDescriptor => ({
  id: `f::${leaf}`,
  name: `greeter > ${leaf}`,
  file: "f.test.ts",
});

describe("resolveTestLines", () => {
  it("attaches each it-declaration line as startLine and the next declaration minus one as endLine", () => {
    const [greets, farewells] = resolveTestLines(FILE, [
      desc("greets the user"),
      desc("farewells the user"),
    ]);

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

  it("keeps native duplicate titles at lines 4 and 8 instead of rebinding both to line 4", () => {
    const descriptors = [
      { ...desc("greets the user"), runnerId: "native-1", startLine: 4 },
      { ...desc("greets the user"), runnerId: "native-2", startLine: 8 },
    ];

    expect(resolveTestLines(FILE, descriptors)).toEqual([
      { ...descriptors[0], endLine: 7 },
      { ...descriptors[1], endLine: 11 },
    ]);
  });

  it("keeps both native parameter cases at line 4 bounded before the next declaration at line 8", () => {
    const descriptors = [
      { ...desc("case 1"), runnerId: "native-1", startLine: 4 },
      { ...desc("case 2"), runnerId: "native-2", startLine: 4 },
      { ...desc("next"), runnerId: "native-3", startLine: 8 },
    ];

    expect(
      resolveTestLines(FILE, descriptors).map(({ endLine }) => endLine),
    ).toEqual([7, 7, 11]);
  });

  it("ends a native test before a declaration the report omits at line 8", () => {
    const descriptors = [
      { ...desc("greets the user"), runnerId: "native-1", startLine: 4 },
      { ...desc("naps"), runnerId: "native-3", startLine: 12 },
    ];

    expect(
      resolveTestLines(FILE, descriptors).map(({ endLine }) => endLine),
    ).toEqual([7, FILE.split("\n").length]);
  });

  it("leaves native bounds unknown when one case lacks its runner location", () => {
    const descriptors = [
      { ...desc("greets the user"), runnerId: "native-1", startLine: 4 },
      { ...desc("farewells the user"), runnerId: "native-2" },
    ];

    expect(resolveTestLines(FILE, descriptors)).toEqual(descriptors);
  });
});
