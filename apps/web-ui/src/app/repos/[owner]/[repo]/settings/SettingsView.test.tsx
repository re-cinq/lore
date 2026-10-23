// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import SettingsView, { type RepoSettingsShape } from "./SettingsView";
import { INITIAL_SAVE_STATE, type SaveState } from "./SaveResultBanner";

const action = vi.fn(async (): Promise<SaveState> => INITIAL_SAVE_STATE);

function renderView(settings: RepoSettingsShape = {}) {
  return render(
    <SettingsView
      fullName="re-cinq/lore"
      team="platform"
      settings={settings}
      allRepos={[{ full_name: "re-cinq/a" }, { full_name: "re-cinq/b" }]}
      saveAction={action}
    />,
  );
}

describe("SettingsView (general only)", () => {
  it("renders the General section prefilled from settings", () => {
    const { container } = renderView({
      task_types: ["general", "review"],
      dispatch_default_type: "general",
      slack_channel_id: "C123",
      trust: { level: "full" },
    });

    expect(
      (container.querySelector('input[name="team"]') as HTMLInputElement).value,
    ).toBe("platform");
    expect(
      (container.querySelector('input[name="task_types"]') as HTMLInputElement)
        .value,
    ).toBe("general, review");
    expect(
      (
        container.querySelector(
          'input[name="dispatch_default_type"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("general");
    expect(container.querySelector('select[name="trust_level"]')).toHaveValue(
      "full",
    );
  });

  it("lists every onboarded repo as a cross-repo option", () => {
    const { container } = renderView();
    const opts = container.querySelectorAll(
      'select[name="cross_repo_repos"] option',
    );

    expect(Array.from(opts).map((o) => (o as HTMLOptionElement).value)).toEqual(
      ["re-cinq/a", "re-cinq/b"],
    );
  });

  it("renders the daily digest section after the cross-repo field", () => {
    const { container } = renderView({ digest: { enabled: true } });
    const names = Array.from(container.querySelectorAll("select, input")).map(
      (field) => field.getAttribute("name"),
    );

    expect(names.indexOf("digest_time")).toBeGreaterThan(
      names.indexOf("cross_repo_repos"),
    );
  });

  it("shows the auto-merge minimum age under Run policy, 24 hours when unset and 6 once saved", () => {
    const field = (settings: RepoSettingsShape) => {
      const input = renderView(settings).container.querySelector(
        'input[name="auto_merge_min_age_hours"]',
      ) as HTMLInputElement;

      return [input.closest("section")?.id, input.value];
    };

    expect([field({}), field({ auto_merge: { min_age_hours: 6 } })]).toEqual([
      ["set-policy", "24"],
      ["set-policy", "6"],
    ]);
  });

  it("links the sub-navigation to the four section cards", () => {
    const { container } = renderView();
    const hrefs = Array.from(
      container.querySelectorAll('nav[aria-label="Settings sections"] a'),
    ).map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual([
      "#set-general",
      "#set-policy",
      "#set-cross-repo",
      "#set-digest",
    ]);
  });

  it("renders no agent or approval-PR controls", () => {
    const { container } = renderView();

    expect(container.querySelector('input[name="approval_pr"]')).toBeNull();
    expect(container.querySelector('select[name="model_select"]')).toBeNull();
  });
});
