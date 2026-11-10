// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";

const createOnboardTask = vi.fn();
const checkRepoAccess = vi.fn();
const listAllRepos = vi.fn();
const listAvailableRepos = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/api/repos", () => ({
  listAllRepos,
  listAvailableRepos,
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

describe("OnboardPage repo fetch", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("populates the picker with repos from the GitHub App installation", async () => {
    listAllRepos.mockResolvedValue({ data: { repos: [] } });
    listAvailableRepos.mockResolvedValue({
      status: "ok",
      data: [{ full_name: "re-cinq/available-service" }],
    });

    const Component = OnboardPage as unknown as (
      props: any,
    ) => Promise<ReactElement> | ReactElement;
    const ui = await Component({});

    render(ui);

    expect(
      document.querySelector('option[value="re-cinq/available-service"]'),
    ).toBeInTheDocument();
  });
});
