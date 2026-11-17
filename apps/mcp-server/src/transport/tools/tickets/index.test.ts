import { describe, it, expect } from "vitest";
import { registerTicketTools } from "./index.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

describe("registerTicketTools", () => {
  it("registers lore_search_tickets", () => {
    expect(Object.keys(toolHandlers(registerTicketTools, "agent"))).toEqual([
      "lore_search_tickets",
    ]);
  });
});
