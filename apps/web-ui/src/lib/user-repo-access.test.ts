import { describe, it, expect } from "vitest";
import { userCanAccessRepo, userCanWriteRepo } from "./user-repo-access";

function fetchReturning(status: number): typeof fetch {
  return (() => Promise.resolve(new Response("", { status }))) as typeof fetch;
}

function fetchReturningJson(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status }),
    )) as typeof fetch;
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

describe("userCanWriteRepo", () => {
  it("returns true when the caller's permissions carry push", async () => {
    const result = await userCanWriteRepo(
      "tok",
      "re-cinq/lore",
      fetchReturningJson(200, { permissions: { push: true, admin: false } }),
    );

    expect(result).toBe(true);
  });

  it("returns true for a repo admin without explicit push", async () => {
    const result = await userCanWriteRepo(
      "tok",
      "re-cinq/lore",
      fetchReturningJson(200, { permissions: { admin: true } }),
    );

    expect(result).toBe(true);
  });

  it("returns false for read-only access to a visible repo", async () => {
    const result = await userCanWriteRepo(
      "tok",
      "re-cinq/public",
      fetchReturningJson(200, { permissions: { push: false, pull: true } }),
    );

    expect(result).toBe(false);
  });

  it("returns false when the permissions block is absent", async () => {
    const result = await userCanWriteRepo(
      "tok",
      "re-cinq/public",
      fetchReturningJson(200, {}),
    );

    expect(result).toBe(false);
  });

  it("returns false when GitHub returns 404 for the repo", async () => {
    const result = await userCanWriteRepo(
      "tok",
      "re-cinq/secret",
      fetchReturning(404),
    );

    expect(result).toBe(false);
  });

  it("returns false when the request throws", async () => {
    const throwing = (() =>
      Promise.reject(new Error("network"))) as typeof fetch;

    const result = await userCanWriteRepo("tok", "re-cinq/lore", throwing);

    expect(result).toBe(false);
  });
});
