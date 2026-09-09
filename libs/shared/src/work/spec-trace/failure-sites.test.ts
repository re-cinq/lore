import { describe, it, expect } from "vitest";
import { parseFailureSites, namesCode } from "./failure-sites.js";

describe("parseFailureSites", () => {
  it("returns src/foo.ts line 12 for a tsc parenthesized diagnostic", () => {
    expect(
      parseFailureSites(
        "src/foo.ts(12,5): error TS2345: Argument of type 'a' is not assignable.",
      ),
    ).toEqual([{ path: "src/foo.ts", line: 12 }]);
  });

  it("returns src/foo.ts line 12 for the tsc colon diagnostic variant", () => {
    expect(
      parseFailureSites("src/foo.ts:12:5 - error TS2345: Argument of type 'a'."),
    ).toEqual([{ path: "src/foo.ts", line: 12 }]);
  });

  it("attributes eslint stylish rows to the bare path header above them", () => {
    const detail = [
      "/repo/src/foo.ts",
      "  12:5  error  Some message  rule/name",
      "  30:1  error  Other message  other/rule",
      "",
    ].join("\n");

    expect(parseFailureSites(detail)).toEqual([
      { path: "repo/src/foo.ts", line: 12 },
      { path: "repo/src/foo.ts", line: 30 },
    ]);
  });

  it("switches file when a second eslint stylish path header appears", () => {
    const detail = [
      "src/a.ts",
      "  1:1  error  msg  rule/name",
      "src/b.ts",
      "  2:2  error  msg  rule/name",
    ].join("\n");

    expect(parseFailureSites(detail)).toEqual([
      { path: "src/a.ts", line: 1 },
      { path: "src/b.ts", line: 2 },
    ]);
  });

  it("returns src/foo.ts line 12 for an eslint compact/unix row", () => {
    expect(
      parseFailureSites("src/foo.ts:12:5: Some message [Error/rule-name]"),
    ).toEqual([{ path: "src/foo.ts", line: 12 }]);
  });

  it("returns foo_test.go line 42 for a go test failure block", () => {
    const detail = [
      "--- FAIL: TestX (0.00s)",
      "    foo_test.go:42: got 1 want 2",
    ].join("\n");

    expect(parseFailureSites(detail)).toEqual([
      { path: "foo_test.go", line: 42 },
    ]);
  });

  it("returns ./pkg/foo.go line 12 for a go build diagnostic", () => {
    expect(parseFailureSites("./pkg/foo.go:12:5: undefined: bar")).toEqual([
      { path: "./pkg/foo.go", line: 12 },
    ]);
  });

  it("returns the vitest FAIL header file with no line", () => {
    expect(parseFailureSites("FAIL src/foo.test.ts > suite > name")).toEqual([
      { path: "src/foo.test.ts" },
    ]);
  });

  it("returns src/foo.ts line 12 for a stack frame inside parentheses", () => {
    expect(
      parseFailureSites("    at Object.<anonymous> (/repo/src/foo.ts:12:5)"),
    ).toEqual([{ path: "repo/src/foo.ts", line: 12 }]);
  });

  it("drops frames inside node_modules", () => {
    const detail = [
      "    at run (/repo/node_modules/vitest/dist/index.js:9:1)",
      "    at test (/repo/src/foo.ts:12:5)",
    ].join("\n");

    expect(parseFailureSites(detail)).toEqual([
      { path: "repo/src/foo.ts", line: 12 },
    ]);
  });

  it("drops a path whose extension is not a supported source extension", () => {
    expect(parseFailureSites("README.md:3:1: broken link")).toEqual([]);
  });

  it("returns two entries for one path reported at two different lines", () => {
    const detail = ["src/foo.ts:12:5: a", "src/foo.ts:30:1: b"].join("\n");

    expect(parseFailureSites(detail)).toEqual([
      { path: "src/foo.ts", line: 12 },
      { path: "src/foo.ts", line: 30 },
    ]);
  });

  it("returns one entry for the same path and line reported twice", () => {
    const detail = ["src/foo.ts:12:5: a", "src/foo.ts:12:9: b"].join("\n");

    expect(parseFailureSites(detail)).toEqual([
      { path: "src/foo.ts", line: 12 },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseFailureSites("")).toEqual([]);
  });

  it("returns an empty array for prose naming no file", () => {
    expect(parseFailureSites("the pod was OOMKilled after 3 minutes")).toEqual(
      [],
    );
  });

  it("returns an empty array for a non-string input", () => {
    expect(parseFailureSites(undefined as unknown as string)).toEqual([]);
  });
});

describe("namesCode", () => {
  it("returns true for unknown", () => {
    expect(namesCode("unknown")).toBe(true);
  });

  it("returns true for null and undefined", () => {
    expect(namesCode(null)).toBe(true);
    expect(namesCode(undefined)).toBe(true);
  });

  it("returns false for every infra or account failure class", () => {
    const infraClasses = [
      "anthropic-credit",
      "anthropic-rate-limit",
      "github-workflows-permission",
      "github-permission",
      "auth",
      "agent-settings-missing",
      "infra",
      "unclaimed",
    ];

    expect(infraClasses.map(namesCode)).toEqual(infraClasses.map(() => false));
  });

  it("returns false for a class outside the taxonomy", () => {
    expect(namesCode("something-new")).toBe(false);
  });
});
