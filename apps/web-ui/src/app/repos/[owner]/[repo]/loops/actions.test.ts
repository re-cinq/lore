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

  it("answers the two-key sentence for a refused auto-merge switch and refreshes nothing", async () => {
    vi.mocked(setLoopEnabled).mockResolvedValue({
      status: "error",
      message: "two_key_required",
      code: 403,
      body: { error: "two_key_required" },
    });

    const refused = await switchLoopAction("re-cinq/lore", "merge", {
      enabled: true,
    });

    expect({
      refused,
      revalidated: vi.mocked(revalidatePath).mock.calls,
    }).toEqual({
      refused:
        "Switching auto merge on is two-key: name a pull request labelled dark-factory-approval and approved by a code owner of CLAUDE.md.",
      revalidated: [],
    });
  });

  it("answers the code-owner check's own detail when the approval PR does not pass it", async () => {
    vi.mocked(setLoopEnabled).mockResolvedValue({
      status: "error",
      message: "codeowners_check_failed",
      code: 403,
      body: {
        error: "codeowners_check_failed",
        detail:
          "re-cinq/lore#123 has no approval from a code owner of CLAUDE.md",
      },
    });

    expect(
      await switchLoopAction("re-cinq/lore", "merge", {
        enabled: true,
        approvalPr: "re-cinq/lore#123",
      }),
    ).toBe("re-cinq/lore#123 has no approval from a code owner of CLAUDE.md");
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
