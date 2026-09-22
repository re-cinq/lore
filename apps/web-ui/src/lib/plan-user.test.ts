import { describe, it, expect } from "vitest";
import { colorFor, planUserOf } from "./plan-user";

describe("planUserOf", () => {
  it("names the signed-in gedaiu by login, shown as Bogdan", () => {
    expect(
      planUserOf({ login: "gedaiu", user: { name: "Bogdan" } }),
    ).toMatchObject({
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

describe("colorFor", () => {
  it("gives gedaiu the same colour on every visit", () => {
    expect(colorFor("gedaiu")).toEqual(colorFor("gedaiu"));
  });

  it("gives gedaiu and ana different colours", () => {
    expect(colorFor("gedaiu")).not.toEqual(colorFor("ana"));
  });
});
