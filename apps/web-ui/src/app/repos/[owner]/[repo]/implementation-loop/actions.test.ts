// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/api/backlog", () => ({
  setImplementationLoopEnabled: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { setImplementationLoopEnabled } from "@/lib/api/backlog";
import { toggleImplementationLoopAction } from "./actions";

beforeEach(() => vi.clearAllMocks());

describe("toggleImplementationLoopAction", () => {
  it("PUTs the flag and revalidates the tab path", async () => {
    vi.mocked(setImplementationLoopEnabled).mockResolvedValue({
      status: "ok",
      data: { ok: true, enabled: true },
    } as never);

    await toggleImplementationLoopAction("re-cinq/lore", true);

    expect(setImplementationLoopEnabled).toHaveBeenCalledWith(
      "re-cinq/lore",
      true,
    );
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
      toggleImplementationLoopAction("re-cinq/lore", true),
    ).rejects.toThrow();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
