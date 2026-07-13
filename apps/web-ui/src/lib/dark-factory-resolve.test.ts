import { describe, it, expect } from "vitest";
import {
  resolveDarkFactorySettings,
  DEFAULT_AUTO_MERGE_PATHS,
} from "./dark-factory-resolve";

describe("resolveDarkFactorySettings (web-ui mirror)", () => {
  it("applies opt-out defaults when partial is null", () => {
    expect(resolveDarkFactorySettings(null)).toMatchObject({
      enabled: false,
      create_issue: "always",
      review: "always",
      notify: ["all"],
    });
  });

  it("applies dark-mode defaults when enabled with no other fields", () => {
    const r = resolveDarkFactorySettings({ enabled: true });
    expect(r).toMatchObject({
      create_issue: "on_gate",
      review: "trust_based",
      notify: [],
    });
    expect(r.auto_merge.paths).toEqual(DEFAULT_AUTO_MERGE_PATHS);
    expect(r.auto_merge.require_green_ci).toBe(true);
  });

  it("respects partial overrides", () => {
    const r = resolveDarkFactorySettings({
      enabled: true,
      create_issue: "always",
      auto_merge: { paths: ["only-this/**"], require_green_ci: false },
    });
    expect(r.create_issue).toBe("always");
    expect(r.auto_merge.paths).toEqual(["only-this/**"]);
    expect(r.auto_merge.min_trust).toBe("docs");
    expect(r.auto_merge.require_green_ci).toBe(false);
  });
});
