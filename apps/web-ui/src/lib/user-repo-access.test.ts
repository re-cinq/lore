import { describe, it, expect } from "vitest";
import { userCanAccessRepo } from "./user-repo-access";

function fetchReturning(status: number): typeof fetch {
  return (() => Promise.resolve(new Response("", { status }))) as typeof fetch;
}

describe("userCanAccessRepo", () => {
  it("returns true when GitHub returns 200 for the repo", async () => {
    const result = await userCanAccessRepo(
      "tok",
      "re-cinq/lore",
      fetchReturning(200),
    );

    expect(result).toBe(true);
  });

  it("returns false when GitHub returns 404 for the repo", async () => {
    const result = await userCanAccessRepo(
      "tok",
      "re-cinq/secret",
      fetchReturning(404),
    );

    expect(result).toBe(false);
  });

  it("returns false when the request throws", async () => {
    const throwing = (() =>
      Promise.reject(new Error("network"))) as typeof fetch;

    const result = await userCanAccessRepo("tok", "re-cinq/lore", throwing);

    expect(result).toBe(false);
  });
});
