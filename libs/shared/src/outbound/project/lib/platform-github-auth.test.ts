import { describe, expect, it } from "vitest";
import { octokitOptions } from "./platform-github-auth.js";

describe("octokitOptions", () => {
  it("returns https://api.github.com when GITHUB_HOST is unset", () => {
    expect(octokitOptions({})).toEqual({ baseUrl: "https://api.github.com" });
  });

  it("returns https://ghe.example.com/api/v3 for host ghe.example.com", () => {
    expect(octokitOptions({ GITHUB_HOST: "ghe.example.com" })).toEqual({
      baseUrl: "https://ghe.example.com/api/v3",
    });
  });
});
