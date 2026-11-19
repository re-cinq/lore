import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { PlanNotApprovableError } from "@re-cinq/planning-sync";
import { approveOrRefuse } from "./plan-approval.js";

describe("approveOrRefuse", () => {
  it("maps validation problem message to detail in the 409 body", async () => {
    const service = {
      approvePlan: async () => {
        throw new PlanNotApprovableError("plan x is not ready", {
          passed: false,
          phase: "approval" as const,
          problems: [
            {
              code: "missing-block" as const,
              slot: "prototype",
              message: "needs a prototype or a sketch",
            },
          ],
        });
      },
    };

    let caught: unknown;

    try {
      await approveOrRefuse(service, "x", "ana");
    } catch (err) {
      caught = err;
    }

    expect(Boom.isBoom(caught)).toBe(true);

    const payload = (caught as Boom.Boom).output.payload as any;

    expect(payload.problems[0]).toMatchObject({
      detail: "needs a prototype or a sketch",
    });
  });
});
