import { describe, expect, it } from "vitest";
import {
  brokenAcceptanceTest,
  parseTestWrongReport,
  testWrongVerdict,
} from "./acceptance-test-report.js";

const YAML_MANIFEST_FAILURE = `### lore-code-trace (failure)

Failed step: Vet and test

--- FAIL: TestIdentityTokenRefreshedOnceOnUnauthorizedFromLoreAPI/--post_retries_once_on_401_with_a_fresh_identity_token (0.04s)
ci_identity.acceptance_test.go:274: run: parsing test-commands manifest: yaml: did not find expected key
FAIL	github.com/re-cinq/lore/apps/lore-code-trace	13.446s`;

const HANDOFF_ASSERTION_FAILURE = `### lore-api (1/2) (failure)

apps/lore-api/src/transport/routes/auth/app-sign-in-hardening.acceptance.test.ts:280 AssertionError: expected { handoffCount: 1, …(2) } to deeply equal { handoffCount: +0, …(2) }`;

const HARDENING_FILE =
  "apps/lore-api/src/transport/routes/auth/app-sign-in-hardening.acceptance.test.ts";

const HARDENING_SOURCE = `describe("GitHub App sign-in hardening", () => {
  it("refuses sign-in through the OAuth App and creates no session after the upgrade", async () => {});
});`;

const WRONG_HANDOFF_REPORT = JSON.stringify({
  file: HARDENING_FILE,
  test: "refuses sign-in through the OAuth App and creates no session after the upgrade",
  reason:
    "expects handoffCount 0 after its own startLoginUrl stores a live state row",
});

describe("brokenAcceptanceTest", () => {
  it("names the yaml manifest line of #12 as an acceptance test that cannot run", () => {
    expect(brokenAcceptanceTest(YAML_MANIFEST_FAILURE)).toEqual(
      "ci_identity.acceptance_test.go:274: run: parsing test-commands manifest: yaml: did not find expected key",
    );
  });

  it("reads the handoffCount assertion of #52 as a red test for the round, not a broken one", () => {
    expect(brokenAcceptanceTest(HANDOFF_ASSERTION_FAILURE)).toBeNull();
  });

  it("names a vitest acceptance file that would not parse, reported on the line after it", () => {
    expect(
      brokenAcceptanceTest(
        'FAIL apps/web-ui/src/Plan.acceptance.test.tsx [ apps/web-ui/src/Plan.acceptance.test.tsx ]\nError: Transform failed with 1 error: Unexpected "}"',
      ),
    ).toEqual(
      'FAIL apps/web-ui/src/Plan.acceptance.test.tsx [ apps/web-ui/src/Plan.acceptance.test.tsx ]\nError: Transform failed with 1 error: Unexpected "}"',
    );
  });

  it("reads a module the acceptance test imports before it exists as the red the round owes", () => {
    expect(
      brokenAcceptanceTest(
        "FAIL apps/web-ui/src/Plan.acceptance.test.tsx\nError: Failed to load url ./Plan.js (resolved id: ./Plan.js)",
      ),
    ).toBeNull();
  });

  it("leaves a syntax error in a round's own test to the round", () => {
    expect(
      brokenAcceptanceTest(
        "apps/lore-api/src/auth.test.ts:3 SyntaxError: Unexpected token",
      ),
    ).toBeNull();
  });
});

describe("parseTestWrongReport", () => {
  it("reads the file, test and reason a round names", () => {
    expect(parseTestWrongReport(WRONG_HANDOFF_REPORT)).toEqual({
      file: HARDENING_FILE,
      test: "refuses sign-in through the OAuth App and creates no session after the upgrade",
      reason:
        "expects handoffCount 0 after its own startLoginUrl stores a live state row",
    });
  });

  it("refuses a report that names a round's own test file", () => {
    expect(
      parseTestWrongReport(
        JSON.stringify({ file: "src/a.test.ts", test: "adds", reason: "x" }),
      ),
    ).toBeNull();
  });

  it("refuses a report that is not JSON or leaves the reason empty", () => {
    expect({
      prose: parseTestWrongReport("the acceptance test is wrong"),
      noReason: parseTestWrongReport(
        JSON.stringify({ file: HARDENING_FILE, test: "x", reason: " " }),
      ),
    }).toEqual({ prose: null, noReason: null });
  });
});

describe("testWrongVerdict", () => {
  it("sends the wrong handoffCount test of #52 back to the definition of done with the round's reason", () => {
    expect(
      testWrongVerdict(parseTestWrongReport(WRONG_HANDOFF_REPORT), {
        source: HARDENING_SOURCE,
        roundFiles: ["apps/lore-api/src/work/auth/login-handoffs.ts"],
      }),
    ).toEqual({
      accepted: true,
      feedback: `# An acceptance test the round could not pass

The round reported that this acceptance test is wrong, and did not change that file.

- File: \`${HARDENING_FILE}\`
- Test: refuses sign-in through the OAuth App and creates no session after the upgrade
- Reason: expects handoffCount 0 after its own startLoginUrl stores a live state row

Fix this test, or remove it, so it fails only for the claim the ticket makes.
`,
    });
  });

  it("treats a report naming a test the file does not hold as a failed round", () => {
    expect(
      testWrongVerdict(
        parseTestWrongReport(
          JSON.stringify({
            file: HARDENING_FILE,
            test: "a test nobody wrote",
            reason: "it cannot pass",
          }),
        ),
        { source: HARDENING_SOURCE, roundFiles: [] },
      ),
    ).toEqual({
      accepted: false,
      reason: `${HARDENING_FILE} holds no test named "a test nobody wrote"`,
    });
  });

  it("treats a report on a file the branch does not have as a failed round", () => {
    expect(
      testWrongVerdict(parseTestWrongReport(WRONG_HANDOFF_REPORT), {
        source: null,
        roundFiles: [],
      }),
    ).toEqual({
      accepted: false,
      reason: `the branch has no ${HARDENING_FILE}`,
    });
  });

  it("treats a round that edited an acceptance test as a failed round", () => {
    expect(
      testWrongVerdict(parseTestWrongReport(WRONG_HANDOFF_REPORT), {
        source: HARDENING_SOURCE,
        roundFiles: [HARDENING_FILE],
      }),
    ).toEqual({
      accepted: false,
      reason: `the round changed the acceptance test ${HARDENING_FILE}`,
    });
  });

  it("accepts a report on a.acceptance.test.ts when the round changed only b.acceptance.test.ts", () => {
    expect(
      testWrongVerdict(
        parseTestWrongReport(
          JSON.stringify({
            file: "a.acceptance.test.ts",
            test: "adds numbers",
            reason: "expects 5 for 2 + 2",
          }),
        ),
        {
          source: 'it("adds numbers", () => {});',
          roundFiles: ["b.acceptance.test.ts"],
        },
      ),
    ).toMatchObject({ accepted: true });
  });

  it("treats a missing or unreadable report as a failed round", () => {
    expect(
      testWrongVerdict(null, { source: HARDENING_SOURCE, roundFiles: [] }),
    ).toEqual({
      accepted: false,
      reason:
        "the round named no acceptance test as {file, test, reason} in tdd_test_wrong",
    });
  });
});
