import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import type { PlanFilePorts } from "../../../work/plans/plan-file.js";
import { planFileRoutes } from "./plan-file.js";

function serve() {
  const failed: unknown[] = [];
  const ports: PlanFilePorts = {
    livePlan: async () => {
      throw new Error("no live plan in this test");
    },
    writer: {
      applyOps: async () => [],
      proposeChanges: async () => [],
      failRefine: async (request) => {
        failed.push(request);
      },
    },
  };
  const server = Hapi.server();

  server.route(planFileRoutes(ports));

  return { server, failed };
}

describe("POST /api/plans/{id}/refine-failed", () => {
  it("marks plan p1's Refine of scope failed with the reason the pass stopped", async () => {
    const { server, failed } = serve();
    const res = await server.inject({
      method: "POST",
      url: "/api/plans/p1/refine-failed",
      payload: {
        slot: "scope",
        reason:
          "the planning agent stopped with exit code 42 before it answered",
      },
    });

    expect({ status: res.statusCode, body: res.result, failed }).toEqual({
      status: 200,
      body: { slot: "scope" },
      failed: [
        {
          planId: "p1",
          slot: "scope",
          reason:
            "the planning agent stopped with exit code 42 before it answered",
        },
      ],
    });
  });

  it("answers 400 to a failure that names no section, and marks nothing", async () => {
    const { server, failed } = serve();
    const res = await server.inject({
      method: "POST",
      url: "/api/plans/p1/refine-failed",
      payload: { reason: "stopped" },
    });

    expect({ status: res.statusCode, failed }).toEqual({
      status: 400,
      failed: [],
    });
  });
});
