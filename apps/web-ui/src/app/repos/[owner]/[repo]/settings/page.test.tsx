// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { SettingsViewProps } from "./SettingsView";
import type { SaveState } from "./SaveResultBanner";

const getRepo = vi.fn();
const listAllRepos = vi.fn();
const putRepoSettings = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/repos", () => ({
  getRepo,
  listAllRepos,
  putRepoSettings,
  reposOrThrow: (result: { data: unknown }) => result.data,
}));

vi.mock("next/cache", () => ({ revalidatePath }));

const { default: RepoSettingsPage } = await import("./page");

type Action = (prev: SaveState, formData: FormData) => Promise<SaveState>;

async function saveSettingsAction(): Promise<Action> {
  getRepo.mockResolvedValue({
    status: "ok",
    data: { team: "platform", settings: {} },
  });
  listAllRepos.mockResolvedValue({ data: { repos: [] } });
  const element = (await RepoSettingsPage({
    params: Promise.resolve({ owner: "re-cinq", repo: "lore" }),
  })) as ReactElement<SettingsViewProps>;

  return element.props.saveAction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveSettings action", () => {
  it("surfaces the server's refusal message in state.error", async () => {
    putRepoSettings.mockResolvedValue({
      status: "error",
      message: "Missing rule: requires 1 approval",
    });

    const action = await saveSettingsAction();
    const formData = new FormData();

    formData.set("full_name", "re-cinq/lore");
    formData.set("team", "platform");

    const state = await action({ saved: false }, formData);

    expect(state).toEqual({
      saved: false,
      error: "Missing rule: requires 1 approval",
    });
  });

  it("returns an unconfigured error when the API is not configured", async () => {
    putRepoSettings.mockResolvedValue({ status: "unconfigured" });

    const action = await saveSettingsAction();
    const formData = new FormData();

    formData.set("full_name", "re-cinq/lore");

    const state = await action({ saved: false }, formData);

    expect(state).toEqual({
      saved: false,
      error: "Lore API is not configured",
    });
  });

  it("sends auto_merge approver lore-reviewer to putRepoSettings", async () => {
    putRepoSettings.mockResolvedValue({ status: "ok", data: { ok: true } });

    const action = await saveSettingsAction();
    const formData = new FormData();

    formData.set("full_name", "re-cinq/lore");
    formData.set("auto_merge_approver", "lore-reviewer");

    await action({ saved: false }, formData);

    expect(putRepoSettings).toHaveBeenCalledWith("re-cinq/lore", {
      team: null,
      settings: expect.objectContaining({
        auto_merge: { approver: "lore-reviewer" },
      }),
    });
  });
});
