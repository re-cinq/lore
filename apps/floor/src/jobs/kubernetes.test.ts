import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentFailed } from "./kubernetes.js";
import { makeAgentsApi, processAgentCr } from "./watcher/agent-watcher.js";

vi.mock("./watcher/agent-watcher.js", () => ({
  makeAgentsApi: vi.fn(),
  processAgentCr: vi.fn(),
}));

function apiThatRejectsWith(err: unknown) {
  return {
    k8sApi: { getNamespacedCustomObject: vi.fn().mockRejectedValue(err) },
    namespace: "ai-agents",
  };
}

beforeEach(() => {
  vi.mocked(processAgentCr).mockReset();
});

describe("kubernetes.agent handler", () => {
  it("treats a 404 on the CR GET as already-pruned (no processing, no throw)", async () => {
    vi.mocked(makeAgentsApi).mockReturnValue(apiThatRejectsWith({ code: 404 }) as never);
    await expect(agentFailed({ agentName: "a-1" })).resolves.toBeUndefined();
    expect(processAgentCr).not.toHaveBeenCalled();
  });

  it("rethrows a 403 on the CR GET so the loop retries instead of marking it handled", async () => {
    vi.mocked(makeAgentsApi).mockReturnValue(apiThatRejectsWith({ code: 403 }) as never);
    await expect(agentFailed({ agentName: "a-1" })).rejects.toMatchObject({ code: 403 });
    expect(processAgentCr).not.toHaveBeenCalled();
  });
});
