import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { testWrongCheckHandle, type TestWrongCheckDeps } from "./station.js";

const BRANCH = "lore/implementation-loop/issue-52";

const HARDENING_FILE =
  "apps/lore-api/src/transport/routes/auth/app-sign-in-hardening.acceptance.test.ts";

const OAUTH_TEST =
  "refuses sign-in through the OAuth App and creates no session after the upgrade";

const BRANCH_FILES: Record<string, string> = {
  [HARDENING_FILE]: `it("${OAUTH_TEST}", async () => {});`,
};

function scene(over: Partial<TestWrongCheckDeps> = {}) {
  const produced: Record<string, string> = {};
  const read: Array<[string, string, string]> = [];
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("")),
    produce: (name, bytes) => {
      produced[name] = bytes.toString("utf8");

      return Promise.resolve();
    },
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const deps: TestWrongCheckDeps = {
    read: (repo, path, branch) => {
      read.push([repo, path, branch]);

      return Promise.resolve(BRANCH_FILES[path] ?? null);
    },
    newestCommitFiles: () =>
      Promise.resolve(["apps/lore-api/src/work/auth/login-handoffs.ts"]),
    ...over,
  };
  const check = (report: string) =>
    testWrongCheckHandle(deps)(
      {
        needs: {
          target: `github.com/re-cinq/lore-security@${BRANCH}`,
          tdd_test_wrong: report,
        },
      } as never,
      tools,
    );

  return { check, produced, read };
}

const reportOf = (test: string) =>
  JSON.stringify({
    file: HARDENING_FILE,
    test,
    reason:
      "expects handoffCount 0 after its own startLoginUrl stores a live state row",
  });

describe("loop-test-wrong-check", () => {
  it("sends the round's report on app-sign-in-hardening.acceptance.test.ts back to dod as dod_feedback", async () => {
    const { check, produced, read } = scene();

    expect({
      result: await check(reportOf(OAUTH_TEST)),
      namesTest: produced.dod_feedback?.includes(OAUTH_TEST),
      read,
    }).toEqual({
      result: { outcome: "success" },
      namesTest: true,
      read: [["re-cinq/lore-security", HARDENING_FILE, BRANCH]],
    });
  });

  it("fails the round and hands dod nothing when the named test is not on the branch", async () => {
    const { check, produced } = scene();

    expect({
      result: await check(reportOf("a test nobody wrote")),
      produced,
    }).toEqual({ result: { outcome: "failed" }, produced: {} });
  });

  it("fails the round when its newest commit changed the acceptance test it reports", async () => {
    const { check, produced } = scene({
      newestCommitFiles: () => Promise.resolve([HARDENING_FILE]),
    });

    expect({
      result: await check(reportOf(OAUTH_TEST)),
      produced,
    }).toEqual({ result: { outcome: "failed" }, produced: {} });
  });

  it("fails the round without reading GitHub when it reported no test", async () => {
    const { check, produced, read } = scene();

    expect({
      result: await check(""),
      produced,
      read,
    }).toEqual({ result: { outcome: "failed" }, produced: {}, read: [] });
  });
});
