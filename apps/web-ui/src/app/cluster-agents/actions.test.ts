import { describe, it, expect, vi, beforeEach } from "vitest";

const setClusterAgentPaused = vi.fn();
const restartClusterAgent = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/cluster-agents", () => ({
  setClusterAgentPaused,
  restartClusterAgent,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

const { toggleClusterPausedAction, restartClusterAgentAction } =
  await import("./actions.js");

beforeEach(() => {
  setClusterAgentPaused.mockReset();
  restartClusterAgent.mockReset();
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

describe("restartClusterAgentAction", () => {
  it("restarts the bound agent and refreshes the page", async () => {
    restartClusterAgent.mockResolvedValue({ status: "ok", data: {} });

    await restartClusterAgentAction("agent-1");

    expect(restartClusterAgent).toHaveBeenCalledWith("agent-1");
    expect(revalidatePath).toHaveBeenCalledWith("/cluster-agents");
  });

  it("throws on a refusal rather than reporting a restart that did not happen", async () => {
    restartClusterAgent.mockResolvedValue({
      status: "error",
      error: "only the central cluster-agent is reachable from lore-api",
    });

    await expect(restartClusterAgentAction("satellite-1")).rejects.toThrow();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
