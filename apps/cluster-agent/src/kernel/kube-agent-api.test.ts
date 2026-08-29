// The 409→created:false branch, driven against the REAL adapter.
//
// It used to be covered only through the inbound `POST /api/cluster/agents`
// route's fake deps — which asserted that a fake returning created:false was
// returned verbatim, i.e. nothing about this mapping. That route is gone (every
// launch is a claim now), and this is the branch that makes a re-launch of the
// same claim idempotent, so it gets a test of its own.

import { describe, expect, it } from "vitest";
import type { CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { KubeAgentApi } from "./kube-agent-api.js";

const agent = { metadata: { name: "a-1" } } as AgentCr;

/** An apiserver that refuses the create with `err`, or accepts it when null. */
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
    // Laundering this into created:false would report a launch that never
    // happened, and the claim would be consumed with no pod behind it.
    await expect(createOn(apiRefusing({ code: 403 }))).rejects.toMatchObject({
      code: 403,
    });
  });
});
