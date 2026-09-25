import { describe, it, expect } from "vitest";
import { planUserOf } from "./plan-user";

describe("planUserOf", () => {
  it("names the signed-in gedaiu by login, shown as Bogdan, with no colour of lore's choosing", () => {
    expect(planUserOf({ login: "gedaiu", user: { name: "Bogdan" } })).toEqual({
      id: "gedaiu",
      name: "Bogdan",
    });
  });

  it("falls back to the display name when a session predates the login", () => {
    expect(planUserOf({ user: { name: "Bogdan" } })).toMatchObject({
      id: "Bogdan",
      name: "Bogdan",
    });
  });

  it("is nobody without a session", () => {
    expect(planUserOf(null)).toBeNull();
  });
});
