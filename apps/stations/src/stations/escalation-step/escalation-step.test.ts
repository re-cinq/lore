import { describe, it, expect } from "vitest";
import {
  runEscalationStep,
  type EscalationStepDeps,
} from "./escalation-step.js";

const INPUT = {
  taskId: "t-1",
  repo: "o/r",
  branchName: "lore/t-1",
  reason: "validation_failed_twice" as const,
  diagnostic: "lint failed on 3 files",
  contributingRefs: [],
};

function deps(over: Partial<EscalationStepDeps> = {}): EscalationStepDeps {
  return {
    escalationInput: async () => INPUT,
    createIssue: async () => ({ number: 7, url: "https://gh/o/r/issues/7" }),
    writeAudit: async () => {},
    notify: async () => {},
    ...over,
  };
}

describe("runEscalationStep — file-issue", () => {
  it("opens the issue and carries its url forward for the notify step", async () => {
    const result = await runEscalationStep("file-issue", "t-1", deps());

    expect(result).toMatchObject({
      outcome: "success",
      extras: { issue_url: "https://gh/o/r/issues/7", issue_number: "7" },
    });
  });

  it("fails the step when the issue cannot be opened, so the line routes to notify anyway", async () => {
    const result = await runEscalationStep(
      "file-issue",
      "t-1",
      deps({
        createIssue: async () => Promise.reject(new Error("403 from GitHub")),
      }),
    );

    expect(result).toMatchObject({ outcome: "failed" });
    expect(result.failureDetail).toMatch(/403 from GitHub/);
  });
});

describe("runEscalationStep — notify", () => {
  it("names the issue when one was filed", async () => {
    const sent: string[] = [];
    const audited: Record<string, unknown>[] = [];

    await runEscalationStep("notify", "t-1", {
      ...deps({
        notify: async (msg) => {
          sent.push(msg);
        },
        writeAudit: async (entry) => {
          audited.push(entry);
        },
      }),
      params: { issue_url: "https://gh/o/r/issues/7" },
    });

    expect(sent[0]).toMatch(/issues\/7/);
    expect(audited[0]).toMatchObject({
      event_type: "escalation_issued",
      payload: { outcome: "issue_created" },
    });
  });

  it("inlines the diagnostic when no issue was filed, so it is not lost", async () => {
    // The audit-only fallback. The Issue surface failed, so the notification is
    // the only place a human can still read what went wrong.
    const sent: string[] = [];
    const audited: Record<string, unknown>[] = [];

    await runEscalationStep("notify", "t-1", {
      ...deps({
        notify: async (msg) => {
          sent.push(msg);
        },
        writeAudit: async (entry) => {
          audited.push(entry);
        },
      }),
      params: {},
    });

    expect(sent[0]).toMatch(/lint failed on 3 files/);
    expect(audited[0]).toMatchObject({
      payload: { outcome: "audit_only" },
    });
  });
});
