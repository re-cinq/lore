// The 404-vs-403 distinction still holds, but the mechanism moved: the cluster
// agent answers `found:false` for a CR that is gone, and throws for anything
// else. These drive the REAL HttpAgentApi against a fake transport, so the
// adapter's own mapping is part of what is asserted.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentFailed } from "./kubernetes.js";
import { processAgentCr } from "./watcher/agent-watcher.js";
import { clusterAgent } from "../kernel/queues.js";

vi.mock("./watcher/agent-watcher.js", () => ({ processAgentCr: vi.fn() }));
vi.mock("../kernel/queues.js", () => ({ clusterAgent: vi.fn() }));

/** A transport that answers as the agent's `GET /agents/{name}` would. */
function transportReturning(answer: unknown) {
  return { call: vi.fn().mockResolvedValue(answer) };
}
function transportRejecting(err: unknown) {
  return { call: vi.fn().mockRejectedValue(err) };
}

beforeEach(() => {
  vi.mocked(processAgentCr).mockReset();
});

describe("kubernetes.agent handler", () => {
  it("treats a pruned CR as nothing to do — no processing, no throw", async () => {
    vi.mocked(clusterAgent).mockReturnValue(
      transportReturning({ found: false, cr: null }) as never,
    );

    await expect(agentFailed({ agentName: "a-1" })).resolves.toBeUndefined();
    expect(processAgentCr).not.toHaveBeenCalled();
  });

  it("rethrows a refusal so the loop retries instead of marking it handled", async () => {
    vi.mocked(clusterAgent).mockReturnValue(
      transportRejecting(
        new Error("cluster GET /agents/a-1 failed: 403"),
      ) as never,
    );

    await expect(agentFailed({ agentName: "a-1" })).rejects.toThrow(/403/);
    expect(processAgentCr).not.toHaveBeenCalled();
  });

  it("processes a CR the agent found", async () => {
    vi.mocked(clusterAgent).mockReturnValue(
      transportReturning({
        found: true,
        cr: { metadata: { name: "a-1" } },
      }) as never,
    );

    await agentFailed({ agentName: "a-1" });

    expect(processAgentCr).toHaveBeenCalledWith(
      { metadata: { name: "a-1" } },
      expect.anything(),
    );
  });

  it("does nothing when the event carries no agent name", async () => {
    await agentFailed({});

    expect(processAgentCr).not.toHaveBeenCalled();
  });
});
