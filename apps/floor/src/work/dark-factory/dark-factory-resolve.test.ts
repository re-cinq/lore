import { describe, it, expect } from "vitest";
import { resolveDarkFactorySettings } from "./dark-factory.js";

describe("resolveDarkFactorySettings (agent-side resolver)", () => {
  it("returns opt-out posture for null partial", () => {
    const r = resolveDarkFactorySettings(null);

    expect(r.enabled).toBe(false);
    expect(r.create_issue).toBe("always");
    expect(r.review).toBe("always");
    expect(r.notify).toEqual(["all"]);
  });

  it("returns opt-out posture for undefined partial", () => {
    const r = resolveDarkFactorySettings(undefined);

    expect(r.enabled).toBe(false);
  });

  it("applies dark-mode defaults when enabled:true, with an empty notify list since escalations always fire via decideNotify", () => {
    const r = resolveDarkFactorySettings({ enabled: true });

    expect(r.create_issue).toBe("on_gate");
    expect(r.review).toBe("trust_based");
    expect(r.notify).toEqual([]);
    expect(r.auto_merge.paths).toContain("CLAUDE.md");
    expect(r.auto_merge.min_trust).toBe("docs");
    expect(r.auto_merge.require_green_ci).toBe(true);
    expect(r.auto_merge.require_bot_approval).toBe(true);
  });

  it("respects partial overrides", () => {
    const r = resolveDarkFactorySettings({
      enabled: true,
      create_issue: "always",
      auto_merge: { paths: ["only-this/**"] },
    });

    expect(r.create_issue).toBe("always");
    expect(r.auto_merge.paths).toEqual(["only-this/**"]);
    expect(r.auto_merge.min_trust).toBe("docs");
    expect(r.auto_merge.require_green_ci).toBe(true);
  });

  it("matches the mcp-server resolver shape (parity), since the agent computes the policy for the auto-merge engine the mcp-server route stored", () => {
    const r = resolveDarkFactorySettings({ enabled: true });

    expect(Object.keys(r).sort()).toEqual([
      "auto_merge",
      "create_issue",
      "enabled",
      "notify",
      "review",
    ]);
    expect(Object.keys(r.auto_merge).sort()).toEqual([
      "min_trust",
      "paths",
      "require_bot_approval",
      "require_green_ci",
    ]);
  });
});
