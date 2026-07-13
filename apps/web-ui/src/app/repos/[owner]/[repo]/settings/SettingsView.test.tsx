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
      auto_review: true,
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
    expect(container.querySelector('select[name="auto_review"]')).toHaveValue(
      "yes",
    );
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

  it("no longer renders dark-factory, agent, or approval-PR controls", () => {
    const { container } = renderView();
    expect(container.querySelector('select[name="df_enabled"]')).toBeNull();
    expect(container.querySelector('input[name="approval_pr"]')).toBeNull();
    expect(container.querySelector('select[name="model_select"]')).toBeNull();
  });
});
