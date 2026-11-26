import { describe, expect, it } from "vitest";
import { updateAvailable } from "./update-available.js";

describe("updateAvailable", () => {
  it("returns true when running v1.2.3 and latest v1.3.0", () => {
    expect(updateAvailable("v1.2.3", "v1.3.0")).toEqual(true);
  });

  it("returns false when running v1.3.0 and latest v1.3.0", () => {
    expect(updateAvailable("v1.3.0", "v1.3.0")).toEqual(false);
  });

  it("returns false when running v1.10.0 and latest v1.9.0", () => {
    expect(updateAvailable("v1.10.0", "v1.9.0")).toEqual(false);
  });

  it("returns false when running the build 0caa086 and latest v1.3.0", () => {
    expect(updateAvailable("0caa086", "v1.3.0")).toEqual(false);
  });

  it("returns false when running v1.2.3 and latest null", () => {
    expect(updateAvailable("v1.2.3", null)).toEqual(false);
  });

  it("returns false when running v1.2.3 and latest is the SHA 0caa086", () => {
    expect(updateAvailable("v1.2.3", "0caa086")).toEqual(false);
  });
});
