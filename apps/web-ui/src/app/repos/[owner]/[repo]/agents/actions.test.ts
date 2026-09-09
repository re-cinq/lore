import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteAgent = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/agents-api", () => ({ deleteAgent }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { removeAgentOverrideAction } = await import("./actions.js");

beforeEach(() => {
  deleteAgent.mockReset();
  revalidatePath.mockReset();
});

describe("removeAgentOverrideAction", () => {
  it("deletes the bound repo's override and refreshes the agents tab", async () => {
    deleteAgent.mockResolvedValue({ status: "ok", agent: { name: "review" } });

    await removeAgentOverrideAction("re-cinq/lore", "review");

    expect(deleteAgent).toHaveBeenCalledWith("re-cinq/lore", "review");
    expect(revalidatePath).toHaveBeenCalledWith("/repos/re-cinq/lore/agents");
  });

  it("throws naming the refusal rather than reporting a removal that did not happen", async () => {
    deleteAgent.mockResolvedValue({
      status: "error",
      message: "agent definition not found",
    });

    await expect(
      removeAgentOverrideAction("re-cinq/lore", "gone"),
    ).rejects.toThrow(
      new Error("remove agent override failed: agent definition not found"),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("throws naming the missing LORE_API_URL and token when the web UI is unconfigured", async () => {
    deleteAgent.mockResolvedValue({ status: "unconfigured" });

    await expect(
      removeAgentOverrideAction("re-cinq/lore", "review"),
    ).rejects.toThrow(/has no LORE_API_URL plus LORE_ADMIN_TOKEN/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
