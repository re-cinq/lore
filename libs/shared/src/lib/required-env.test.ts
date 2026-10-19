import { describe, it, expect } from "vitest";
import { requiredEnv, requiredPort } from "./required-env.js";

describe("requiredEnv", () => {
  it("returns the value the deployment supplied", () => {
    expect(requiredEnv({ PORT: "8080" }, "PORT")).toBe("8080");
  });

  it("refuses an unset name rather than guessing a default", () => {
    expect(() => requiredEnv({}, "PORT")).toThrow(
      new Error("PORT is not set — the deployment must supply it"),
    );
  });
});

describe("requiredPort", () => {
  it("returns 8080 for PORT=8080", () => {
    expect(requiredPort({ PORT: "8080" }, "PORT")).toBe(8080);
  });

  it("refuses 8080abc, which parseInt would have read as 8080", () => {
    expect(() => requiredPort({ PORT: "8080abc" }, "PORT")).toThrow(
      new Error('PORT must be a port number in 1..65535, got "8080abc"'),
    );
  });

  it("refuses 70000, above the port range", () => {
    expect(() => requiredPort({ PORT: "70000" }, "PORT")).toThrow(
      new Error('PORT must be a port number in 1..65535, got "70000"'),
    );
  });

  it("refuses 0, below the port range", () => {
    expect(() => requiredPort({ PORT: "0" }, "PORT")).toThrow(
      new Error('PORT must be a port number in 1..65535, got "0"'),
    );
  });
});
