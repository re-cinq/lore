import { describe, expect, it } from "vitest";
import {
  descriptorsFromVitestModules,
  type VitestModuleSnapshot,
} from "./trace-descriptors.js";

function nativeModule(
  overrides: {
    project?: string;
    error?: string;
    suiteError?: string;
    status?: "passed" | "failed" | "skipped" | "pending";
    location?: { line: number; column: number } | null;
    expectedFailure?: boolean;
  } = {},
): VitestModuleSnapshot {
  const parent = {
    type: "suite" as const,
    name: "Outer > literal",
    errors: () => (overrides.suiteError ? [overrides.suiteError] : []),
    parent: { type: "module" as const, name: "a.test.ts", errors: () => [] },
  };
  const test = {
    id: "-123_0_0",
    fullName: "Outer > literal > renders",
    project: { name: overrides.project ?? "node" },
    parent,
    location:
      overrides.location === null
        ? undefined
        : (overrides.location ?? { line: 8, column: 3 }),
    options: { fails: overrides.expectedFailure },
    result: () => ({ state: overrides.status ?? ("passed" as const) }),
  };

  return {
    moduleId: "/repo/libs/shared/src/a.test.ts",
    errors: () => (overrides.error ? [overrides.error] : []),
    children: { allTests: () => [test] },
  };
}

describe("descriptorsFromVitestModules", () => {
  it("records native id -123_0_0, line 8 and the literal suite name for a passed case", () => {
    const descriptors = descriptorsFromVitestModules([nativeModule()], {
      pkg: "libs/shared",
      executed: true,
    });

    expect(descriptors).toEqual([
      {
        id: "libs/shared/src/a.test.ts::Outer > literal > renders",
        name: "Outer > literal > renders",
        file: "libs/shared/src/a.test.ts",
        suite: ["Outer > literal"],
        startLine: 8,
        runnerId: JSON.stringify([
          "libs/shared/src/a.test.ts",
          "node",
          "-123_0_0",
        ]),
        execution: {
          status: "passed",
          location: { line: 8, column: 3 },
          expectedFailure: false,
          fileCaseCount: 1,
        },
      },
    ]);
  });
  it.each(["passed", "failed", "skipped", "pending"] as const)(
    "retains the runner's %s result without using the file outcome",
    (status) => {
      const [descriptor] = descriptorsFromVitestModules(
        [nativeModule({ status })],
        { pkg: "libs/shared", executed: true },
      );

      expect(descriptor.execution?.status).toEqual(status);
    },
  );

  it("records collection as unknown even when the supplied case says passed", () => {
    const [descriptor] = descriptorsFromVitestModules([nativeModule()], {
      pkg: "libs/shared",
      executed: false,
    });

    expect(descriptor.execution).toEqual({
      status: "unknown",
      location: { line: 8, column: 3 },
      expectedFailure: false,
      fileCaseCount: 1,
    });
  });
  it.each([
    { error: "afterAll failed" },
    { suiteError: "beforeAll failed" },
    { unhandledErrors: ["unhandled rejection"] },
  ])("records unknown for runner errors %j", (failure) => {
    const [descriptor] = descriptorsFromVitestModules([nativeModule(failure)], {
      pkg: "libs/shared",
      executed: true,
      ...failure,
    });

    expect(descriptor.execution?.status).toEqual("unknown");
  });

  it("keeps expected failure explicit and gives projects node and browser different runner ids", () => {
    const descriptors = descriptorsFromVitestModules(
      [
        nativeModule({ expectedFailure: true }),
        nativeModule({ project: "browser" }),
      ],
      { pkg: "libs/shared", executed: true },
    );

    expect({
      runnerIds: descriptors.map((descriptor) => descriptor.runnerId),
      expectedFailures: descriptors.map(
        (descriptor) => descriptor.execution?.expectedFailure,
      ),
    }).toEqual({
      runnerIds: [
        JSON.stringify(["libs/shared/src/a.test.ts", "node", "-123_0_0"]),
        JSON.stringify(["libs/shared/src/a.test.ts", "browser", "-123_0_0"]),
      ],
      expectedFailures: [true, false],
    });
  });

  it.each([
    { line: 0, column: 3 },
    { line: 8, column: 0 },
    { line: 1.5, column: 3 },
    { line: 8, column: 1.5 },
    null,
  ])(
    "omits invalid or missing location %j instead of guessing from its title",
    (location) => {
      const [descriptor] = descriptorsFromVitestModules(
        [nativeModule({ location })],
        { pkg: "libs/shared", executed: true },
      );

      expect({
        startLine: descriptor.startLine,
        execution: descriptor.execution,
      }).toEqual({
        startLine: undefined,
        execution: {
          status: "passed",
          expectedFailure: false,
          fileCaseCount: 1,
        },
      });
    },
  );
});
