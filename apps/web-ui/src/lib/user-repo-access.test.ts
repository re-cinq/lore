import { describe, it, expect, vi, afterEach } from "vitest";
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

// A gate that cannot say WHY it denied is a support ticket. The three reasons are
// materially different — 404 is "this token cannot see the repo" (private repo, or
// an OAuth app the org has never approved), 401 is a stale or revoked token, 403 is
// a rate limit — and the caller only ever sees one flat "Access denied".
describe("what a denial reports to the server log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the repo and GitHub's status when access is refused", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await userCanAccessRepo("tok", "re-cinq/lore", fetchReturning(404));

    expect(warn.mock.calls[0]?.[0]).toEqual(
      "[repo-access] denied re-cinq/lore: GitHub answered 404 (a 404 here usually means the OAuth app has no access to the org, not that the repo is missing)",
    );
  });

  it("distinguishes a stale token from a repo the token cannot see", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await userCanAccessRepo("tok", "re-cinq/lore", fetchReturning(401));

    expect(warn.mock.calls[0]?.[0]).toEqual(
      "[repo-access] denied re-cinq/lore: GitHub answered 401 (the session's token is stale or revoked — signing out and back in mints a new one)",
    );
  });

  it("reports the transport failure when the request never lands", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = (() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof fetch;

    await userCanAccessRepo("tok", "re-cinq/lore", throwing);

    expect(warn.mock.calls[0]?.[0]).toEqual(
      "[repo-access] denied re-cinq/lore: could not reach GitHub — getaddrinfo ENOTFOUND",
    );
  });

  it("says nothing at all when access is granted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await userCanAccessRepo("tok", "re-cinq/lore", fetchReturning(200));

    expect(warn).not.toHaveBeenCalled();
  });

  it("never writes the token to the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await userCanAccessRepo(
      "gho_supersecret",
      "re-cinq/lore",
      fetchReturning(404),
    );

    expect(JSON.stringify(warn.mock.calls)).not.toContain("gho_supersecret");
  });
});
