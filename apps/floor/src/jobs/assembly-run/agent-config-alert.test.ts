import { describe, it, expect } from "vitest";
import {
  agentConfigAlertMessage,
  maybeAlertAgentConfig,
} from "./agent-config-alert.js";
import { BillingAlertThrottle } from "./billing-alert.js";

const settingsMissingStatus = {
  output:
    '{"kind":"lifecycle","phase":"agent","status":"started"}\n' +
    "[agent] Error: Settings file not found: /agent/.claude/settings.json\n" +
    '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
  failureReason: "BackoffLimitExceeded: Job has reached the backoff limit",
};

describe("agentConfigAlertMessage", () => {
  it("names the repo, node type, and the missing-settings error", () => {
    const message = agentConfigAlertMessage(
      "re-cinq/lore",
      "implement",
      settingsMissingStatus,
    );

    expect(message).toContain("skills_source");
    expect(message).toContain("Settings file not found");
    expect(message).toContain("re-cinq/lore");
    expect(message).toContain("implement");
  });

  it("carries the remediation hint for the category", () => {
    expect(
      agentConfigAlertMessage(
        "re-cinq/lore",
        "implement",
        settingsMissingStatus,
      ),
    ).toContain("skills registry");
  });

  it("returns null for a failure that is not the missing-settings signature", () => {
    expect(
      agentConfigAlertMessage("re-cinq/lore", "review", {
        output: "some other crash",
        failureReason: "OOMKilled",
      }),
    ).toBeNull();
  });

  it("returns null when the output carries no result line at all", () => {
    expect(
      agentConfigAlertMessage("re-cinq/lore", "review", {
        failureReason: "BackoffLimitExceeded",
      }),
    ).toBeNull();
  });
});

describe("maybeAlertAgentConfig", () => {
  it("sends one throttled alert for a missing-settings failure and reports it sent", async () => {
    const sent: string[] = [];
    const throttle = new BillingAlertThrottle(60_000, () => 0);
    const ports = {
      notify: async (_level: string, message: string) => {
        sent.push(message);
      },
      throttle,
    };

    expect(
      await maybeAlertAgentConfig(
        "re-cinq/lore",
        "implement",
        settingsMissingStatus,
        ports,
      ),
    ).toBe(true);
    expect(
      await maybeAlertAgentConfig(
        "re-cinq/other",
        "review",
        settingsMissingStatus,
        ports,
      ),
    ).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("does not send or consume the throttle for an unrelated failure", async () => {
    let sends = 0;
    const throttle = new BillingAlertThrottle(60_000, () => 0);
    const ports = {
      notify: async () => {
        sends += 1;
      },
      throttle,
    };

    expect(
      await maybeAlertAgentConfig(
        "re-cinq/lore",
        "review",
        { failureReason: "OOMKilled" },
        ports,
      ),
    ).toBe(false);
    expect(sends).toBe(0);
    expect(
      await maybeAlertAgentConfig(
        "re-cinq/lore",
        "implement",
        settingsMissingStatus,
        ports,
      ),
    ).toBe(true);
  });

  it("swallows a notify throw so a failed alert never fails the node-event handler", async () => {
    const ports = {
      notify: async () => {
        throw new Error("slack down");
      },
      throttle: new BillingAlertThrottle(60_000, () => 0),
    };

    expect(
      await maybeAlertAgentConfig(
        "re-cinq/lore",
        "implement",
        settingsMissingStatus,
        ports,
      ),
    ).toBe(false);
  });
});
