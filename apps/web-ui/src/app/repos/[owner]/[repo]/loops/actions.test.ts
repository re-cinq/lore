// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/api/loops", () => ({ setLoopEnabled: vi.fn() }));
vi.mock("@/lib/api/repos", () => ({ onboardRepo: vi.fn() }));

import { revalidatePath } from "next/cache";
import { setLoopEnabled } from "@/lib/api/loops";
import { onboardRepo } from "@/lib/api/repos";
import { retryOnboardingAction, switchLoopAction } from "./actions";

beforeEach(() => vi.clearAllMocks());

describe("switchLoopAction", () => {
  it("PUTs the triage switch and revalidates the Loops tab", async () => {
    vi.mocked(setLoopEnabled).mockResolvedValue({
      status: "ok",
      data: { ok: true, key: "triage", enabled: false },
    } as never);

    await switchLoopAction("re-cinq/lore", "triage", { enabled: false });

    expect(setLoopEnabled).toHaveBeenCalledWith("re-cinq/lore", "triage", {
      enabled: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/repos/re-cinq/lore/loops");
  });

  it("throws on a failed write instead of reporting a silent success", async () => {
    vi.mocked(setLoopEnabled).mockResolvedValue({
      status: "error",
      message: "403",
    } as never);

    await expect(
      switchLoopAction("re-cinq/lore", "implementation", { enabled: true }),
    ).rejects.toThrow();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("retryOnboardingAction", () => {
  it("queues the repo's onboarding again and refreshes the Loops tab", async () => {
    vi.mocked(onboardRepo).mockResolvedValue({
      status: "ok",
      data: { repo_id: "r1", task_id: "t1", status: "pending" },
    } as never);

    await retryOnboardingAction("re-cinq/Otto");

    expect(onboardRepo).toHaveBeenCalledWith("re-cinq/Otto");
    expect(revalidatePath).toHaveBeenCalledWith("/repos/re-cinq/Otto/loops");
  });
});
