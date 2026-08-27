import { describe, it, expect, vi, beforeEach } from "vitest";

const setClusterAgentPaused = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/cluster-agents", () => ({ setClusterAgentPaused }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { toggleClusterPausedAction } = await import("./actions.js");

beforeEach(() => {
  setClusterAgentPaused.mockReset();
  revalidatePath.mockReset();
});

describe("toggleClusterPausedAction", () => {
  it("pauses the bound agent and refreshes the page", async () => {
    setClusterAgentPaused.mockResolvedValue({ status: "ok", data: {} });

    await toggleClusterPausedAction("agent-1", true);

    expect(setClusterAgentPaused).toHaveBeenCalledWith("agent-1", true);
    expect(revalidatePath).toHaveBeenCalledWith("/cluster-agents");
  });

  it("throws on a refusal rather than reporting a pause that did not happen", async () => {
    setClusterAgentPaused.mockResolvedValue({
      status: "error",
      error: "cluster agent not found",
    });

    await expect(toggleClusterPausedAction("gone", true)).rejects.toThrow();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
