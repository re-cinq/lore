import { describe, it, expect } from "vitest";
import { enforceBootEnv } from "./boot-env.js";

const LONG_TOKEN = "a".repeat(32);

describe("enforceBootEnv", () => {
  it("accepts an environment with no FLOOR_GIT_CREDENTIAL_TOKEN", () => {
    expect(() => enforceBootEnv({})).not.toThrow();
  });

  it("accepts a FLOOR_GIT_CREDENTIAL_TOKEN of exactly 32 characters", () => {
    expect(() =>
      enforceBootEnv({ FLOOR_GIT_CREDENTIAL_TOKEN: LONG_TOKEN }),
    ).not.toThrow();
  });

  it("refuses a FLOOR_GIT_CREDENTIAL_TOKEN of 31 characters", () => {
    expect(() =>
      enforceBootEnv({ FLOOR_GIT_CREDENTIAL_TOKEN: "a".repeat(31) }),
    ).toThrow(
      new Error("FLOOR_GIT_CREDENTIAL_TOKEN must be at least 32 characters"),
    );
  });

  it("refuses the next token of a rotation pair when it is shorter than 32 characters", () => {
    expect(() =>
      enforceBootEnv({ FLOOR_GIT_CREDENTIAL_TOKEN: `${LONG_TOKEN},short` }),
    ).toThrow(
      new Error("FLOOR_GIT_CREDENTIAL_TOKEN must be at least 32 characters"),
    );
  });

  it("accepts a rotation pair of two 32-character tokens with a trailing newline", () => {
    expect(() =>
      enforceBootEnv({
        FLOOR_GIT_CREDENTIAL_TOKEN: `${LONG_TOKEN}, ${"b".repeat(32)}\n`,
      }),
    ).not.toThrow();
  });

  it("accepts an empty FLOOR_GIT_CREDENTIAL_TOKEN, which the route answers 503", () => {
    expect(() =>
      enforceBootEnv({ FLOOR_GIT_CREDENTIAL_TOKEN: "" }),
    ).not.toThrow();
  });
});
