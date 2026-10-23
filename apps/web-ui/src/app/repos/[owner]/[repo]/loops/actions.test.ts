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

    const refused = await switchLoopAction("re-cinq/lore", "triage", {
      enabled: false,
    });

    expect({
      refused,
      asked: vi.mocked(setLoopEnabled).mock.calls,
      revalidated: vi.mocked(revalidatePath).mock.calls,
    }).toEqual({
      refused: null,
      asked: [["re-cinq/lore", "triage", { enabled: false }]],
      revalidated: [["/repos/re-cinq/lore/loops"]],
    });
  });

  it("answers lore-api's own detail when it refuses the switch, and refreshes nothing", async () => {
    vi.mocked(setLoopEnabled).mockResolvedValue({
      status: "error",
      message: "Not Found",
      code: 404,
      body: { error: "Not Found", detail: "repo not found: re-cinq/lore" },
    });

    const refused = await switchLoopAction("re-cinq/lore", "merge", {
      enabled: true,
      min_age_hours: 6,
    });

    expect({
      refused,
      asked: vi.mocked(setLoopEnabled).mock.calls,
      revalidated: vi.mocked(revalidatePath).mock.calls,
    }).toEqual({
      refused: "repo not found: re-cinq/lore",
      asked: [["re-cinq/lore", "merge", { enabled: true, min_age_hours: 6 }]],
      revalidated: [],
    });
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
