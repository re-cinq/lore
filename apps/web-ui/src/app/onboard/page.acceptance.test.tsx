// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";

const createOnboardTask = vi.fn();
const checkRepoAccess = vi.fn();
const listAllRepos = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/api/repos", () => ({
  listAllRepos,
  reposOrThrow: (result: { data: unknown }) => result.data,
}));
vi.mock("@/lib/github", () => ({ checkRepoAccess }));
vi.mock("@/lib/onboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/onboard")>()),
  createOnboardTask,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const { default: OnboardPage } = await import("./page");

describe("UX Redesign + Repo Onboarding", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("shows available repos", async () => {
    listAllRepos.mockResolvedValue({ data: { repos: [] } });

    const Component = OnboardPage as unknown as (
      props: any,
    ) => Promise<JSX.Element> | JSX.Element;
    const ui = await Component({});

    render(ui);

    expect(
      screen.getByRole("combobox", { name: /repository/i }),
    ).toBeInTheDocument();
  });

  it("keeps the user on the form with the reason when onboarding is refused", async () => {
    listAllRepos.mockResolvedValue({ data: { repos: [] } });

    const Component = OnboardPage as unknown as (
      props: any,
    ) => Promise<JSX.Element> | JSX.Element;
    const ui = await Component({});

    const props = (ui as ReactElement<{ onboardRepoAction: any }>).props;
    const action = props.onboardRepoAction;

    const formData = new FormData();

    formData.set("full_name", "re-cinq/refused");

    createOnboardTask.mockResolvedValue({
      ok: false,
      block: "already-onboarded",
      message: "re-cinq/refused is already onboarded.",
      taskId: null,
    });

    const state = await action(null, formData);

    expect(state).toEqual({
      error: "re-cinq/refused is already onboarded.",
      fullName: "re-cinq/refused",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lands on the repository page on success", async () => {
    listAllRepos.mockResolvedValue({ data: { repos: [] } });

    const Component = OnboardPage as unknown as (
      props: any,
    ) => Promise<JSX.Element> | JSX.Element;
    const ui = await Component({});

    const props = (ui as ReactElement<{ onboardRepoAction: any }>).props;
    const action = props.onboardRepoAction;

    const formData = new FormData();

    formData.set("full_name", "re-cinq/new-repo");

    createOnboardTask.mockResolvedValue({
      ok: true,
      taskId: "task-1",
    });
    checkRepoAccess.mockResolvedValue("ok");

    await expect(action(null, formData)).rejects.toThrow(
      "NEXT_REDIRECT:/repos/re-cinq/new-repo",
    );
  });
});
