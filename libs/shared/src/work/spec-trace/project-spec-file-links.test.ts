import { describe, it, expect } from "vitest";
import { resolveTestName } from "./project-spec-file-links.js";

describe("resolveTestName", () => {
  it("returns the declaration title at the linked line when readLinked provides the file", async () => {
    const content = [
      "",
      "import { it } from 'vitest';",
      "it('actually tests the thing', () => {",
      "  // body",
      "});",
    ].join("\n");
    const link = {
      label: "validated by",
      path: "src/x.test.ts",
      line: 3,
      hash: null,
    };

    expect(await resolveTestName(link, async () => content)).toBe(
      "actually tests the thing",
    );
  });

  it("falls back to the label when readLinked is absent", async () => {
    const link = {
      label: "validated by",
      path: "src/x.test.ts",
      line: 3,
      hash: null,
    };

    expect(await resolveTestName(link, undefined)).toBe("validated by");
  });

  it("falls back to the label when readLinked returns null", async () => {
    const link = {
      label: "validated by",
      path: "src/x.test.ts",
      line: 3,
      hash: null,
    };

    expect(await resolveTestName(link, async () => null)).toBe("validated by");
  });

  it("falls back to the label when no declaration is at or above the line", async () => {
    const content = "const x = 1;\n";
    const link = {
      label: "some label",
      path: "src/x.test.ts",
      line: 1,
      hash: null,
    };

    expect(await resolveTestName(link, async () => content)).toBe("some label");
  });

  it("falls back to the label when link.line is null", async () => {
    const link = {
      label: "validated by",
      path: "src/x.test.ts",
      line: null,
      hash: null,
    };

    expect(
      await resolveTestName(link, async () => "it('found', () => {})"),
    ).toBe("validated by");
  });
});
