// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/api/backlog", () => ({
  setImplementationLoopEnabled: vi.fn(),
}));
vi.mock("@/lib/api/repos", () => ({ onboardRepo: vi.fn() }));

import { revalidatePath } from "next/cache";
import { setImplementationLoopEnabled } from "@/lib/api/backlog";
import { onboardRepo } from "@/lib/api/repos";
import {
  retryOnboardingAction,
  toggleImplementationLoopAction,
} from "./actions";

beforeEach(() => vi.clearAllMocks());

describe("toggleImplementationLoopAction", () => {
  it("PUTs the flag and revalidates the tab path", async () => {
    vi.mocked(setImplementationLoopEnabled).mockResolvedValue({
      status: "ok",
      data: { ok: true, enabled: true },
    } as never);

    await toggleImplementationLoopAction("re-cinq/lore", { enabled: true });

    expect(setImplementationLoopEnabled).toHaveBeenCalledWith("re-cinq/lore", {
      enabled: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/repos/re-cinq/lore/implementation-loop",
    );
  });

  it("throws on a failed write instead of reporting a silent success", async () => {
    vi.mocked(setImplementationLoopEnabled).mockResolvedValue({
      status: "error",
      message: "403",
    } as never);

    await expect(
      toggleImplementationLoopAction("re-cinq/lore", { enabled: true }),
    ).rejects.toThrow();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("retryOnboardingAction", () => {
  it("queues the repo's onboarding again and refreshes the tab", async () => {
    vi.mocked(onboardRepo).mockResolvedValue({
      status: "ok",
      data: { repo_id: "r1", task_id: "t1", status: "pending" },
    } as never);

    await retryOnboardingAction("re-cinq/Otto");

    expect(onboardRepo).toHaveBeenCalledWith("re-cinq/Otto");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/repos/re-cinq/Otto/implementation-loop",
    );
  });
});
