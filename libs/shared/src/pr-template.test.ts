import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const templatePath = fileURLToPath(
  new URL("../../../.github/PULL_REQUEST_TEMPLATE.md", import.meta.url),
);
const template = readFileSync(templatePath, "utf8");

describe("PULL_REQUEST_TEMPLATE.md", () => {
  it("contains a Why section heading", () => {
    expect(template).toContain("## Why");
  });

  it("contains a What Changed section heading", () => {
    expect(template).toContain("## What Changed");
  });

  it("contains an Alternatives Considered section heading", () => {
    expect(template).toContain("## Alternatives Considered");
  });

  it("contains an ADRs & Architecture section heading", () => {
    expect(template).toContain("## ADRs & Architecture");
  });

  it("contains a Testing section heading", () => {
    expect(template).toContain("## Testing");
  });

  it("contains all five required section headings", () => {
    expect(template).toContain("## Why");
    expect(template).toContain("## What Changed");
    expect(template).toContain("## Alternatives Considered");
    expect(template).toContain("## ADRs & Architecture");
    expect(template).toContain("## Testing");
  });
});
