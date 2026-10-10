import { describe, expect, it } from "vitest";
import { resolveRoute } from "./route-template.js";

const scope = {
  args: {
    pr_url: "https://github.com/re-cinq/lore/pull/412",
    plan_id: "plan-from-args",
  },
  needs: { plan_id: "plan-7" },
  repo: "re-cinq/lore",
};

describe("resolveRoute", () => {
  it("fills {args.pr_url} from the run's args", () => {
    expect(resolveRoute("{args.pr_url}", scope)).toBe(
      "https://github.com/re-cinq/lore/pull/412",
    );
  });

  it("fills {plan_id} from the visit's needs before the run's args", () => {
    expect(resolveRoute("/repos/re-cinq/lore/plans/{plan_id}", scope)).toBe(
      "/repos/re-cinq/lore/plans/plan-7",
    );
  });

  it("fills {repo} from the run's repository re-cinq/lore", () => {
    expect(resolveRoute("/repos/{repo}/plans/{plan_id}", scope)).toBe(
      "/repos/re-cinq/lore/plans/plan-7",
    );
  });

  it("answers null when nothing fills {issue_url}", () => {
    expect(resolveRoute("{issue_url}", scope)).toBeNull();
  });

  it("answers a route with no placeholder as it is", () => {
    expect(resolveRoute("/plans", scope)).toBe("/plans");
  });

  it("answers null for {constructor}, which no scope owns", () => {
    expect(resolveRoute("/{constructor}", scope)).toBeNull();
  });
});
