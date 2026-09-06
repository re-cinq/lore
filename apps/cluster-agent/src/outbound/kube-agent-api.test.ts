import { describe, expect, it } from "vitest";
import type { CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { KubeAgentApi } from "./kube-agent-api.js";

const agent = { metadata: { name: "a-1" } } as AgentCr;

function apiRefusing(err: unknown): CustomObjectsApi {
  return {
    createNamespacedCustomObject: () =>
      err === null ? Promise.resolve({}) : Promise.reject(err),
  } as unknown as CustomObjectsApi;
}

const createOn = (api: CustomObjectsApi): Promise<{ created: boolean }> =>
  new KubeAgentApi(() => api).create(agent);

describe("KubeAgentApi.create", () => {
  it("reports created:true when the apiserver accepts the CR", async () => {
    expect(await createOn(apiRefusing(null))).toEqual({
      name: "a-1",
      created: true,
    });
  });

  it("reports created:false for code 409, so a redelivered claim is idempotent", async () => {
    expect(await createOn(apiRefusing({ code: 409 }))).toEqual({
      name: "a-1",
      created: false,
    });
  });

  it("reports created:false for a 409 carried on response.statusCode", async () => {
    expect(
      await createOn(apiRefusing({ response: { statusCode: 409 } })),
    ).toEqual({ name: "a-1", created: false });
  });

  it("reports created:false for an 'already exists' message with no code", async () => {
    expect(
      await createOn(
        apiRefusing(new Error("agents.re-cinq.com already exists")),
      ),
    ).toEqual({ name: "a-1", created: false });
  });

  it("rethrows a 403, which means the Role is missing rather than the CR present", async () => {
    await expect(createOn(apiRefusing({ code: 403 }))).rejects.toMatchObject({
      code: 403,
    });
  });
});
