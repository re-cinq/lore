import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteAgent = vi.fn();
const putRepoSettings = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/agents-api", () => ({ deleteAgent }));
vi.mock("@/lib/api/repos", () => ({ putRepoSettings }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { removeAgentOverrideAction, saveBaseImageAction } =
  await import("./actions.js");

beforeEach(() => {
  deleteAgent.mockReset();
  putRepoSettings.mockReset();
  revalidatePath.mockReset();
});

describe("saveBaseImageAction", () => {
  it("saves the selected base image and refreshes the agents and settings tabs", async () => {
    putRepoSettings.mockResolvedValue({ status: "ok", data: { ok: true } });
    const formData = new FormData();

    formData.set("base_image", "node:20-alpine");

    await saveBaseImageAction("re-cinq/lore", formData);

    expect(putRepoSettings).toHaveBeenCalledWith("re-cinq/lore", {
      settings: { base_image: "node:20-alpine" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/repos/re-cinq/lore/agents");
  });

  it("clears the base image to null when the selection is empty", async () => {
    putRepoSettings.mockResolvedValue({ status: "ok", data: { ok: true } });
    const formData = new FormData();

    formData.set("base_image", "");

    await saveBaseImageAction("re-cinq/lore", formData);

    expect(putRepoSettings).toHaveBeenCalledWith("re-cinq/lore", {
      settings: { base_image: null },
    });
  });
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

  it("throws naming the missing LORE_API_URL or session when the web UI is unconfigured", async () => {
    deleteAgent.mockResolvedValue({ status: "unconfigured" });

    await expect(
      removeAgentOverrideAction("re-cinq/lore", "review"),
    ).rejects.toThrow(/has no LORE_API_URL set or no signed-in session/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
