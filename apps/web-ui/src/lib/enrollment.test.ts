import { describe, it, expect } from "vitest";
import {
  computeEnrollmentChecks,
  passSummary,
  type EnrollmentInput,
} from "./enrollment";

const NOW = new Date("2026-05-29T12:00:00Z").getTime();
const daysBefore = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function input(overrides: Partial<EnrollmentInput> = {}): EnrollmentInput {
  return {
    onboarded: true,
    onboardedAt: daysBefore(60),
    onboardingPrMerged: true,
    onboardingPrUrl: "https://github.com/re-cinq/x/pull/1",
    lastIngestedAt: daysBefore(1),
    chunkCount: 41,
    hasConventions: true,
    team: "platform",
    githubFiles: {
      "AGENTS.md": true,
      ".github/workflows/lore-ingest.yml": true,
    },
    webhook: null,
    localMcp: { developerCount: 2, lastActivity: daysBefore(1) },
    now: NOW,
    ...overrides,
  };
}

const byId = (checks: ReturnType<typeof computeEnrollmentChecks>, id: string) =>
  checks.find((c) => c.id === id)!;

describe("computeEnrollmentChecks", () => {
  it("onboarded passes with the onboarded date when registered", () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ onboardedAt: "2026-03-30T10:00:00Z" })),
        "onboarded",
      ),
    ).toMatchObject({ status: "pass", detail: "since 2026-03-30" });
  });

  it("onboarded passes noting registration when onboarded without a date", () => {
    expect(
      byId(computeEnrollmentChecks(input({ onboardedAt: null })), "onboarded"),
    ).toMatchObject({ status: "pass", detail: "registered in Lore" });
  });

  it("onboarded fails when not registered", () => {
    expect(
      byId(computeEnrollmentChecks(input({ onboarded: false })), "onboarded")
        .status,
    ).toBe("fail");
  });

  it("onboarding PR warns with a merge link when open", () => {
    const c = byId(
      computeEnrollmentChecks(input({ onboardingPrMerged: false })),
      "onboarding-pr",
    );
    expect(c).toMatchObject({
      status: "warn",
      link: { href: "https://github.com/re-cinq/x/pull/1" },
    });
  });

  it("onboarding PR check is omitted when there is no PR url", () => {
    const checks = computeEnrollmentChecks(input({ onboardingPrUrl: null }));
    expect(checks.find((c) => c.id === "onboarding-pr")).toBeUndefined();
  });

  it("context ingested fails when never ingested", () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ lastIngestedAt: null })),
        "ingested",
      ),
    ).toMatchObject({ status: "fail", detail: "never ingested" });
  });

  it("context ingested warns when older than 7 days", () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ lastIngestedAt: daysBefore(12) })),
        "ingested",
      ).status,
    ).toBe("warn");
  });

  it("context ingested passes when fresh", () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ lastIngestedAt: daysBefore(2) })),
        "ingested",
      ).status,
    ).toBe("pass");
  });

  it('context ingested reads "today" when ingested within the day', () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ lastIngestedAt: daysBefore(0) })),
        "ingested",
      ).detail,
    ).toContain("last ingest today");
  });

  it("conventions fails when neither AGENTS.md nor CLAUDE.md is ingested", () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ hasConventions: false })),
        "conventions",
      ).status,
    ).toBe("fail");
  });

  it("team warns and notes org_shared when unassigned", () => {
    expect(
      byId(computeEnrollmentChecks(input({ team: null })), "team"),
    ).toMatchObject({ status: "warn", detail: "using org_shared" });
  });

  it("github file is pass / fail / unknown for true / false / null", () => {
    const checks = computeEnrollmentChecks(
      input({
        githubFiles: {
          "AGENTS.md": true,
          "CLAUDE.md": false,
          ".github/workflows/lore-ingest.yml": null,
        },
      }),
    );
    expect(byId(checks, "gh:AGENTS.md").status).toBe("pass");
    expect(byId(checks, "gh:CLAUDE.md").status).toBe("fail");
    expect(byId(checks, "gh:.github/workflows/lore-ingest.yml")).toMatchObject({
      status: "unknown",
      detail: "GitHub App has no repo access",
    });
  });

  it("present github file with no known purpose passes without a detail", () => {
    const c = byId(
      computeEnrollmentChecks(input({ githubFiles: { "random.md": true } })),
      "gh:random.md",
    );
    expect(c.status).toBe("pass");
    expect(c.detail).toBeUndefined();
  });

  it("known github file explains its purpose when present", () => {
    expect(
      byId(
        computeEnrollmentChecks(input()),
        "gh:.github/workflows/lore-ingest.yml",
      ),
    ).toMatchObject({
      status: "pass",
      detail:
        "push-triggered context ingestion — keeps Lore fresh on every push",
    });
  });

  it("missing github file explains its purpose and offers to open a PR with it", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({
            githubFiles: { ".github/workflows/lore-ingest.yml": false },
          }),
        ),
        "gh:.github/workflows/lore-ingest.yml",
      ),
    ).toMatchObject({
      status: "fail",
      detail:
        "missing · push-triggered context ingestion — keeps Lore fresh on every push",
      action: { kind: "reonboard", text: "create a PR with this file" },
    });
  });

  it("missing unknown github file falls back to a generic missing detail with the PR action", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({ githubFiles: { "some/other-file.yml": false } }),
        ),
        "gh:some/other-file.yml",
      ),
    ).toMatchObject({
      status: "fail",
      detail: "missing",
      action: { kind: "reonboard", text: "create a PR with this file" },
    });
  });

  it("local MCP passes with developer count when sessions exist", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({
            localMcp: { developerCount: 1, lastActivity: daysBefore(3) },
          }),
        ),
        "local-mcp",
      ),
    ).toMatchObject({ status: "pass", detail: "1 developer · last 3d ago" });
  });

  it("local MCP passes without a last-seen suffix when activity is unknown", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({ localMcp: { developerCount: 2, lastActivity: null } }),
        ),
        "local-mcp",
      ),
    ).toMatchObject({ status: "pass", detail: "2 developers" });
  });

  it("local MCP fails when no sessions recorded", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({ localMcp: { developerCount: 0, lastActivity: null } }),
        ),
        "local-mcp",
      ),
    ).toMatchObject({
      status: "fail",
      detail: "no local Claude Code sessions yet",
    });
  });

  it("omits the webhook check when status was not fetched", () => {
    expect(
      computeEnrollmentChecks(input({ webhook: null })).find(
        (c) => c.id === "webhook",
      ),
    ).toBeUndefined();
  });

  it("webhook passes when configured", () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ webhook: { state: "configured" } })),
        "webhook",
      ),
    ).toMatchObject({ status: "pass", detail: "delivering to the Floor" });
  });

  it("webhook fails when missing and offers the set-up action", () => {
    expect(
      byId(
        computeEnrollmentChecks(input({ webhook: { state: "missing" } })),
        "webhook",
      ),
    ).toMatchObject({
      status: "fail",
      action: { kind: "setup-webhook", text: "set up" },
    });
  });

  it("webhook warns on a failing delivery and notes the last code", () => {
    const c = byId(
      computeEnrollmentChecks(
        input({ webhook: { state: "delivery_failing", lastCode: 401 } }),
      ),
      "webhook",
    );
    expect(c).toMatchObject({
      status: "warn",
      action: { kind: "setup-webhook" },
    });
    expect(c.detail).toContain("401");
  });

  it("webhook is unknown (no action) when the App lacks the webhook permission", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({
            webhook: { state: "unknown", reason: "app_no_webhook_permission" },
          }),
        ),
        "webhook",
      ),
    ).toMatchObject({
      status: "unknown",
      detail: "GitHub App lacks the Webhooks permission",
    });
  });

  const HOOK_URL = "https://lore-webhook.gcp.re-cinq.com/api/webhook/github";

  it("webhook surfaces the URL to set by hand when not configured", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({ webhook: { state: "missing", canonicalUrl: HOOK_URL } }),
        ),
        "webhook",
      ).copy,
    ).toEqual({ value: HOOK_URL, label: "set this URL" });
  });

  it("webhook still surfaces the URL when the App lacks permission (manual is the only path)", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({
            webhook: {
              state: "unknown",
              reason: "app_no_webhook_permission",
              canonicalUrl: HOOK_URL,
            },
          }),
        ),
        "webhook",
      ).copy,
    ).toEqual({ value: HOOK_URL, label: "set this URL" });
  });

  it("webhook omits the copy URL when already configured", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({ webhook: { state: "configured", canonicalUrl: HOOK_URL } }),
        ),
        "webhook",
      ).copy,
    ).toBeUndefined();
  });

  it("webhook omits the copy URL when the host is not configured", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({
            webhook: {
              state: "unknown",
              reason: "webhook_host_not_configured",
            },
          }),
        ),
        "webhook",
      ).copy,
    ).toBeUndefined();
  });

  it("webhook surfaces the signing secret next to the URL for manual setup", () => {
    const c = byId(
      computeEnrollmentChecks(
        input({
          webhook: {
            state: "missing",
            canonicalUrl: HOOK_URL,
            secret: "whsec_x",
          },
        }),
      ),
      "webhook",
    );
    expect(c.copy).toEqual({ value: HOOK_URL, label: "set this URL" });
    expect(c.secret).toEqual({ value: "whsec_x", label: "and this secret" });
  });

  it("webhook omits the secret when already configured (not fetched)", () => {
    expect(
      byId(
        computeEnrollmentChecks(
          input({
            webhook: {
              state: "configured",
              canonicalUrl: HOOK_URL,
              secret: "whsec_x",
            },
          }),
        ),
        "webhook",
      ).secret,
    ).toBeUndefined();
  });

  it("passSummary counts passing over total", () => {
    expect(passSummary(computeEnrollmentChecks(input()))).toEqual({
      passed: 8,
      total: 8,
    });
  });
});
