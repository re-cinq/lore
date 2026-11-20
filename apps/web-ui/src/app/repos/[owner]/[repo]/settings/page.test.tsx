// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { SettingsViewProps } from "./SettingsView";
import type { SaveState } from "./SaveResultBanner";

const getRepo = vi.fn();
const listAllRepos = vi.fn();
const putRepoSettings = vi.fn();
const moveMirror = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/repos", () => ({
  getRepo,
  listAllRepos,
  putRepoSettings,
  moveMirror,
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
      message: "context_backend must be lore, utopia or both",
    });

    const action = await saveSettingsAction();
    const formData = new FormData();

    formData.set("full_name", "re-cinq/lore");
    formData.set("team", "platform");

    const state = await action({ saved: false }, formData);

    expect(state).toEqual({
      saved: false,
      error: "context_backend must be lore, utopia or both",
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
});

describe("saveSettings action public mirror", () => {
  it("sends public_mirror acme/public when the field holds it and none is saved", async () => {
    putRepoSettings.mockResolvedValue({ status: "ok", data: { ok: true } });

    const action = await saveSettingsAction();
    const formData = new FormData();

    formData.set("full_name", "re-cinq/lore");
    formData.set("public_mirror", "acme/public");
    await action({ saved: false }, formData);

    expect(putRepoSettings.mock.calls[0]?.[1]).toMatchObject({
      settings: { public_mirror: "acme/public" },
    });
  });

  it("surfaces the refusal that acme/public is already a mirror", async () => {
    putRepoSettings.mockResolvedValue({
      status: "error",
      message: "acme/public is already a public mirror",
    });

    const action = await saveSettingsAction();
    const formData = new FormData();

    formData.set("full_name", "re-cinq/lore");
    formData.set("public_mirror", "acme/public");

    expect(await action({ saved: false }, formData)).toEqual({
      saved: false,
      error: "acme/public is already a public mirror",
    });
  });
});

describe("saveSettings action sent settings", () => {
  const baseSettings = {
    task_types: [],
    cross_repo: false,
    cross_repo_repos: [],
    digest: {
      time: "09:00",
      days: [],
      timezone: "Europe/Berlin",
      sections: [],
      voice: "",
    },
    implementation_loop: { done_check: false },
  };

  async function saveWithMirror(saved: { status: string; data?: object }) {
    const action = await saveSettingsAction();
    const formData = new FormData();

    formData.set("full_name", "re-cinq/lore");
    formData.set("public_mirror", "acme/public");
    getRepo.mockResolvedValue(saved);
    putRepoSettings.mockResolvedValue({ status: "ok", data: { ok: true } });
    await action({ saved: false }, formData);

    return putRepoSettings.mock.calls[0]?.[1].settings;
  }

  it("sends no public_mirror key when acme/public equals the saved mirror", async () => {
    expect(
      await saveWithMirror({
        status: "ok",
        data: { settings: { public_mirror: "acme/public" } },
      }),
    ).toEqual(baseSettings);
  });

  it("sends public_mirror acme/public when the saved settings cannot be read", async () => {
    expect(await saveWithMirror({ status: "error" })).toEqual({
      ...baseSettings,
      public_mirror: "acme/public",
    });
  });
});

describe("moveMirror prop of the page", () => {
  it("is bound to re-cinq/lore and answers a 403 with the only-an-admin sentence", async () => {
    getRepo.mockResolvedValue({
      status: "ok",
      data: { team: "platform", settings: {} },
    });
    listAllRepos.mockResolvedValue({ data: { repos: [] } });
    moveMirror.mockResolvedValue({
      status: "error",
      message: "forbidden",
      code: 403,
    });
    const element = (await RepoSettingsPage({
      params: Promise.resolve({ owner: "re-cinq", repo: "lore" }),
    })) as ReactElement<SettingsViewProps>;
    const outcome = await element.props.moveMirror({ dry_run: true });

    expect({ calls: moveMirror.mock.calls, outcome }).toEqual({
      calls: [["re-cinq/lore", { dry_run: true }]],
      outcome: {
        ok: false,
        said: "Could not move the mirror's knowledge: only an admin can move it.",
      },
    });
  });
});
