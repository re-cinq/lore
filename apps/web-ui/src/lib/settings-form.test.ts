import { describe, it, expect } from "vitest";
import { parseSettingsForm, parsePrivilegedChanges } from "./settings-form";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

describe("parseSettingsForm", () => {
  it('auto_review is true when auto_review is "yes"', () => {
    expect(parseSettingsForm(form({ auto_review: "yes" })).auto_review).toBe(
      true,
    );
  });

  it('auto_review is false when auto_review is "no"', () => {
    expect(parseSettingsForm(form({ auto_review: "no" })).auto_review).toBe(
      false,
    );
  });

  it("dispatch_default_type trimmed when present, omitted when blank", () => {
    expect(
      parseSettingsForm(form({ dispatch_default_type: " implementation " }))
        .dispatch_default_type,
    ).toBe("implementation");
    expect(
      "dispatch_default_type" in
        parseSettingsForm(form({ dispatch_default_type: "  " })),
    ).toBe(false);
  });

  it("task_types split into trimmed, non-empty values", () => {
    expect(
      parseSettingsForm(form({ task_types: "general, gap-fill , ,review" }))
        .task_types,
    ).toEqual(["general", "gap-fill", "review"]);
  });

  it("cross_repo enabled with the selected repos when any are chosen", () => {
    expect(
      parseSettingsForm(form({ cross_repo_repos: ["re-cinq/a", "re-cinq/b"] })),
    ).toMatchObject({
      cross_repo: true,
      cross_repo_repos: ["re-cinq/a", "re-cinq/b"],
    });
  });

  it("cross_repo disabled with empty repos when none chosen", () => {
    expect(parseSettingsForm(form({}))).toMatchObject({
      cross_repo: false,
      cross_repo_repos: [],
    });
  });

  it("trust set with auto_promote_threshold when trust_level present", () => {
    expect(parseSettingsForm(form({ trust_level: "full" })).trust).toEqual({
      level: "full",
      auto_promote_threshold: 3,
    });
  });

  it("trust key absent when trust_level missing", () => {
    expect(parseSettingsForm(form({})).trust).toBeUndefined();
  });

  it("slack_channel_id and dispatch_label trimmed when present", () => {
    expect(
      parseSettingsForm(
        form({ slack_channel_id: " C123 ", dispatch_label: " lore " }),
      ),
    ).toMatchObject({ slack_channel_id: "C123", dispatch_label: "lore" });
  });

  it("omits slack_channel_id and dispatch_label keys when blank", () => {
    const result = parseSettingsForm(
      form({ slack_channel_id: "   ", dispatch_label: "" }),
    );
    expect("slack_channel_id" in result).toBe(false);
    expect("dispatch_label" in result).toBe(false);
  });
});

describe("parsePrivilegedChanges", () => {
  const TYPES = ["implementation", "review"];

  it("empty patch when nothing differs from current", () => {
    const current = {
      dark_factory: {
        enabled: false,
        execution: { image: "ghcr.io/re-cinq/lore-claude-runner:latest" },
      },
    };
    const fd = form({
      df_enabled: "no",
      df_execution_image: "ghcr.io/re-cinq/lore-claude-runner:latest",
    });
    expect(parsePrivilegedChanges(fd, current, TYPES)).toEqual({});
  });

  it("flags dark_factory.enabled when toggled on", () => {
    const fd = form({ df_enabled: "yes" });
    expect(
      parsePrivilegedChanges(fd, { dark_factory: { enabled: false } }, TYPES),
    ).toEqual({ dark_factory: { enabled: true } });
  });

  it("does NOT emit execution.image when unchanged (avoids spurious two-key)", () => {
    const current = { dark_factory: { execution: { image: "golang:1.23" } } };
    const fd = form({ df_execution_image: "golang:1.23" });
    expect(parsePrivilegedChanges(fd, current, TYPES)).toEqual({});
  });

  it("emits dark_factory.execution.image when changed", () => {
    const current = { dark_factory: { execution: { image: "golang:1.22" } } };
    const fd = form({ df_execution_image: "golang:1.23" });
    expect(parsePrivilegedChanges(fd, current, TYPES)).toEqual({
      dark_factory: { execution: { image: "golang:1.23" } },
    });
  });

  it("does NOT emit execution.image when unchanged", () => {
    const current = { dark_factory: { execution: { image: "golang:1.22" } } };
    const fd = form({ df_execution_image: "golang:1.22" });
    expect(parsePrivilegedChanges(fd, current, TYPES)).toEqual({});
  });

  it("emits changed auto_merge sub-fields nested under auto_merge", () => {
    const current = {
      dark_factory: {
        auto_merge: { min_trust: "docs", require_green_ci: true },
      },
    };
    const fd = form({ df_am_min_trust: "full", df_am_green_ci: "no" });
    expect(parsePrivilegedChanges(fd, current, TYPES)).toEqual({
      dark_factory: {
        auto_merge: { min_trust: "full", require_green_ci: false },
      },
    });
  });

  it("splits auto_merge paths on newlines and commas", () => {
    const fd = form({ df_am_paths: "specs/**\nCLAUDE.md, docs/**" });
    expect(parsePrivilegedChanges(fd, { dark_factory: {} }, TYPES)).toEqual({
      dark_factory: {
        auto_merge: { paths: ["specs/**", "CLAUDE.md", "docs/**"] },
      },
    });
  });

  it("diffs the notify channel list", () => {
    const current = { dark_factory: { notify: ["escalation"] } };
    const fd = form({ df_notify: ["escalation", "watched"] });
    expect(parsePrivilegedChanges(fd, current, TYPES)).toEqual({
      dark_factory: { notify: ["escalation", "watched"] },
    });
  });

  it("emits task_overrides.<type>.execution.image when a per-type image changes", () => {
    const fd = form({ to_implementation_image: "golang:1.23" });
    expect(parsePrivilegedChanges(fd, {}, TYPES)).toEqual({
      task_overrides: {
        implementation: { execution: { image: "golang:1.23" } },
      },
    });
  });

  it("emits non-privileged per-type fields (model/timeout/suffix) as changes too", () => {
    const fd = form({
      to_review_model: "claude-opus-4-8",
      to_review_timeout: "45",
    });
    expect(parsePrivilegedChanges(fd, {}, TYPES)).toEqual({
      task_overrides: {
        review: { model: "claude-opus-4-8", timeout_minutes: 45 },
      },
    });
  });

  it("does not emit a per-type entry when nothing in that row changed", () => {
    const current = {
      task_overrides: { implementation: { model: "claude-opus-4-8" } },
    };
    const fd = form({ to_implementation_model: "claude-opus-4-8" });
    expect(parsePrivilegedChanges(fd, current, TYPES)).toEqual({});
  });
});
