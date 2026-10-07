// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
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

type Action = (
  prev: unknown,
  formData: FormData,
) => Promise<{ error: string; fullName: string }>;

async function onboardAction(): Promise<Action> {
  listAllRepos.mockResolvedValue({ data: { repos: [] } });
  const element = (await OnboardPage()) as ReactElement<{
    onboardRepoAction: Action;
  }>;

  return element.props.onboardRepoAction;
}

function form(fullName: string): FormData {
  const submission = new FormData();

  submission.set("full_name", fullName);

  return submission;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRepoAccess.mockResolvedValue("ok");
});

describe("onboard action", () => {
  it("redirects to the repository page when onboarding queues task-1", async () => {
    createOnboardTask.mockResolvedValue({ ok: true, taskId: "task-1" });
    const action = await onboardAction();

    await expect(action(null, form("re-cinq/lore"))).rejects.toThrow(
      "NEXT_REDIRECT:/repos/re-cinq/lore",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("redirects to the repo page when there is no task id", async () => {
    createOnboardTask.mockResolvedValue({ ok: true, taskId: "" });
    const action = await onboardAction();

    await expect(action(null, form("re-cinq/lore"))).rejects.toThrow(
      "NEXT_REDIRECT:/repos/re-cinq/lore",
    );
  });

  it("stays on the form with the refusal when onboarding is refused", async () => {
    createOnboardTask.mockResolvedValue({
      ok: false,
      block: "in-flight",
      message: "an onboard task is already in flight",
      taskId: "task-7",
    });
    const action = await onboardAction();

    expect(await action(null, form("re-cinq/lore"))).toEqual({
      error: "an onboard task is already in flight",
      fullName: "re-cinq/lore",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("rejects a malformed repository without calling the API", async () => {
    const action = await onboardAction();

    const state = await action(null, form("not-a-repo"));

    expect(state.error).toContain("not a valid repository");
    expect(createOnboardTask).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
