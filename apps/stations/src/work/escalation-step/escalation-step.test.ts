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
      args: { issue_url: "https://gh/o/r/issues/7", issue_number: "7" },
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
      params: { issue_url: "https://gh/o/r/issues/7", issue_number: "7" },
    });

    expect(sent[0]).toMatch(/issues\/7/);
    expect(audited[0]).toMatchObject({
      event_type: "escalation_issued",
      payload: { outcome: "issue_created", issue_number: "7" },
    });
  });

  it("inlines the diagnostic when no issue was filed, so it is not lost", async () => {
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

    expect(sent[0]).toMatch(/Issue creation failed/);
    expect(sent[0]).toMatch(/## Lore Pipeline Escalation/);
    expect(sent[0]).toMatch(/lint failed on 3 files/);
    expect(audited[0]).toMatchObject({
      payload: { outcome: "audit_only" },
    });
  });
});

describe("filing the issue survives a transient refusal", () => {
  it("retries and succeeds, so a 503 does not degrade a real escalation to audit-only", async () => {
    let attempts = 0;

    const result = await runEscalationStep(
      "file-issue",
      "t-1",
      deps({
        createIssue: async () => {
          attempts++;

          return attempts < 3
            ? Promise.reject(new Error("503 upstream"))
            : Promise.resolve({ number: 7, url: "https://gh/o/r/issues/7" });
        },
        retry: { attempts: 5, delayMs: 1 },
      }),
    );

    expect(attempts).toBe(3);
    expect(result.outcome).toBe("success");
  });

  it("gives up after the last attempt, so the line still reaches notify", async () => {
    const result = await runEscalationStep(
      "file-issue",
      "t-1",
      deps({
        createIssue: async () => Promise.reject(new Error("503 upstream")),
        retry: { attempts: 2, delayMs: 1 },
      }),
    );

    expect(result.outcome).toBe("failed");
  });
});

describe("filing an issue whose surface returns no url", () => {
  it("omits issue_url rather than carrying an empty string forward", async () => {
    const result = await runEscalationStep(
      "file-issue",
      "t-1",
      deps({ createIssue: async () => ({ number: 7 }) }),
    );

    expect(result).toMatchObject({
      outcome: "success",
      args: { issue_number: "7" },
    });
    expect(result.args).not.toHaveProperty("issue_url");
  });
});

describe("notify after an issue filed without a url", () => {
  it("still audits issue_created and names issue #7, since the number proves the filing", async () => {
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
      params: { issue_number: "7" },
    });

    expect(sent[0]).toMatch(/issue #7/);
    expect(audited[0]).toMatchObject({
      payload: { outcome: "issue_created", issue_number: "7" },
    });
  });
});

describe("notify with no params on the step at all", () => {
  it("treats a missing params object the same as no issue filed", async () => {
    const sent: string[] = [];
    const audited: Record<string, unknown>[] = [];

    await runEscalationStep(
      "notify",
      "t-1",
      deps({
        notify: async (msg) => {
          sent.push(msg);
        },
        writeAudit: async (entry) => {
          audited.push(entry);
        },
      }),
    );

    expect(sent[0]).toMatch(/Issue creation failed/);
    expect(audited[0]).toMatchObject({
      payload: { outcome: "audit_only" },
    });
  });
});
