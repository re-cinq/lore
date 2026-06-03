import { describe, it, expect } from "vitest";
import { parseTestLinksInStatement } from "./spec-link-parser";

describe("parseTestLinksInStatement", () => {
  it("returns an empty array when the statement has no trailing parenthetical", () => {
    expect(parseTestLinksInStatement("Returns the expected value.")).toEqual([]);
  });

  it("returns an empty array when the trailing paren contains no markdown links", () => {
    expect(parseTestLinksInStatement("Returns. (a plain note in parens)")).toEqual([]);
  });

  it("parses a single test-link parenthetical at end of statement", () => {
    const out = parseTestLinksInStatement(
      "Claims a pending task. ([validated by `runner.test.ts:88`](mcp-server/src/local-runner.test.ts#L88))",
    );
    expect(out).toEqual([
      {
        label: "validated by `runner.test.ts:88`",
        path: "mcp-server/src/local-runner.test.ts",
        line: 88,
      },
    ]);
  });

  it("parses multiple comma-separated test links inside one paren", () => {
    const out = parseTestLinksInStatement(
      "Survives rollout via lease backend. ([primary](agent/src/supervisor/lease.test.ts#L42), [takeover](agent/src/supervisor/lease.test.ts#L74))",
    );
    expect(out).toEqual([
      { label: "primary", path: "agent/src/supervisor/lease.test.ts", line: 42 },
      { label: "takeover", path: "agent/src/supervisor/lease.test.ts", line: 74 },
    ]);
  });

  it("ignores non-test links inside the trailing paren", () => {
    const out = parseTestLinksInStatement(
      "Uses the lease pattern. ([test](agent/src/supervisor/lease.test.ts#L42), [ADR-015](adrs/ADR-015.md))",
    );
    expect(out).toEqual([{ label: "test", path: "agent/src/supervisor/lease.test.ts", line: 42 }]);
  });

  it("returns an empty array when the trailing paren contains only non-test links", () => {
    expect(parseTestLinksInStatement("Per the ADR. ([see ADR-015](adrs/ADR-015.md))")).toEqual([]);
  });

  it("parses a link with no #Lline anchor (line is null)", () => {
    const out = parseTestLinksInStatement("Has a file-level test. ([test file](src/x.test.ts))");
    expect(out).toEqual([{ label: "test file", path: "src/x.test.ts", line: null }]);
  });

  it("strips a leading slash on the href so paths normalize repo-relative", () => {
    const out = parseTestLinksInStatement("Absolute-style href. ([test](/src/x.test.ts#L1))");
    expect(out[0].path).toBe("src/x.test.ts");
  });

  it("recognizes the Go test path convention", () => {
    const out = parseTestLinksInStatement("Go service. ([test](pkg/store/store_test.go#L120))");
    expect(out).toEqual([{ label: "test", path: "pkg/store/store_test.go", line: 120 }]);
  });

  it("ignores links mid-text when there is no trailing paren", () => {
    const out = parseTestLinksInStatement(
      "Some [internal link](src/x.test.ts#L42) reference mid-text, with no trailing paren.",
    );
    expect(out).toEqual([]);
  });

  it("handles a trailing period after the closing parenthesis", () => {
    const out = parseTestLinksInStatement("Statement. ([test](src/x.test.ts#L42)).");
    expect(out).toEqual([{ label: "test", path: "src/x.test.ts", line: 42 }]);
  });

  it("collapses internal whitespace in the label", () => {
    const out = parseTestLinksInStatement(
      "Statement. ([validated by  the   runner test](src/x.test.ts#L42))",
    );
    expect(out[0].label).toBe("validated by the runner test");
  });
});
