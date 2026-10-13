import { describe, it, expect } from "vitest";
import { planStatusBadge } from "./plan-status";

describe("planStatusBadge", () => {
  it("labels an approved plan Approved in the success colour", () => {
    expect(planStatusBadge("approved")).toEqual({
      label: "Approved",
      color: "var(--success)",
    });
  });

  it("labels a draft plan Draft in the muted colour", () => {
    expect(planStatusBadge("draft")).toEqual({
      label: "Draft",
      color: "var(--text-muted)",
    });
  });

  it("shows a status it does not know as itself, muted", () => {
    expect(planStatusBadge("archived")).toEqual({
      label: "archived",
      color: "var(--text-muted)",
    });
  });
});
