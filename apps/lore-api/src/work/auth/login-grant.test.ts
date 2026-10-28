import { describe, it, expect } from "vitest";
import {
  authorizeUrl,
  errorRedirect,
  orgRepoNames,
  redeemRedirect,
  repoAllowed,
  returnUrlAllowed,
  scopesForRole,
} from "./login-grant.js";

describe("scopesForRole", () => {
  it("grants admin scope to an org admin", () => {
    expect(scopesForRole("admin")).toEqual(["admin"]);
  });

  it("grants read, write and task to an org member", () => {
    expect(scopesForRole("member")).toEqual(["read", "write", "task"]);
  });
});

describe("returnUrlAllowed", () => {
  const env = { LORE_UI_URL: "https://lore.gcp.re-cinq.com" };

  it("allows a page on the configured UI origin", () => {
    expect(
      returnUrlAllowed("https://lore.gcp.re-cinq.com/auth/callback", env),
    ).toBe(true);
  });

  it("allows a localhost page over http on any port", () => {
    expect(returnUrlAllowed("http://localhost:3000/auth/callback", env)).toBe(
      true,
    );
  });

  it("rejects another host", () => {
    expect(returnUrlAllowed("https://evil.example/auth/callback", env)).toBe(
      false,
    );
  });

  it("rejects a host that only starts with the UI hostname", () => {
    expect(
      returnUrlAllowed("https://lore.gcp.re-cinq.com.evil.example/x", env),
    ).toBe(false);
  });

  it("rejects a non-http scheme", () => {
    expect(returnUrlAllowed("javascript:alert(1)", env)).toBe(false);
  });

  it("rejects text that is not a URL", () => {
    expect(returnUrlAllowed("not a url", env)).toBe(false);
  });

  it("rejects https localhost, which the local UI never uses", () => {
    expect(returnUrlAllowed("https://localhost:3000/x", env)).toBe(false);
  });
});

describe("authorizeUrl", () => {
  it("points at GitHub with the client, callback, scopes and state", () => {
    const url = new URL(
      authorizeUrl({
        clientId: "client-1",
        redirectUri: "https://api.example/api/auth/callback",
        state: "state-1",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: "https://api.example/api/auth/callback",
      scope: "read:user read:org repo",
      state: "state-1",
    });
  });
});

describe("orgRepoNames", () => {
  const repos = [
    { full_name: "re-cinq/lore", owner: { login: "re-cinq" } },
    { full_name: "someone/else", owner: { login: "someone" } },
  ];

  it("keeps only the org's repos when an org is set", () => {
    expect(orgRepoNames(repos, "re-cinq")).toEqual(["re-cinq/lore"]);
  });

  it("keeps every repo when no org is set", () => {
    expect(orgRepoNames(repos, undefined)).toEqual([
      "re-cinq/lore",
      "someone/else",
    ]);
  });
});

describe("redirects back to the page that signed in", () => {
  it("adds the redeem code and keeps the existing query", () => {
    expect(
      redeemRedirect("http://localhost:3000/auth/callback?x=1", "code-1"),
    ).toBe("http://localhost:3000/auth/callback?x=1&code=code-1");
  });

  it("adds the failure reason", () => {
    expect(
      errorRedirect("http://localhost:3000/auth/callback", "not_in_org"),
    ).toBe("http://localhost:3000/auth/callback?auth_error=not_in_org");
  });
});

describe("repoAllowed", () => {
  const person = (scopes: string[], repos: string[]) => ({
    scopes,
    user: { repos },
  });

  it("allows a repo in the person's list, whatever its case", () => {
    expect(
      repoAllowed(person(["read"], ["re-cinq/lore"]), "Re-Cinq/Lore"),
    ).toBe(true);
  });

  it("refuses a repo outside the person's list", () => {
    expect(
      repoAllowed(person(["read"], ["re-cinq/lore"]), "someone/else"),
    ).toBe(false);
  });

  it("allows any repo to an admin", () => {
    expect(repoAllowed(person(["admin"], []), "someone/else")).toBe(true);
  });

  it("allows any repo to a token that is no person's session", () => {
    expect(repoAllowed({ scopes: ["read"], user: null }, "someone/else")).toBe(
      true,
    );
  });
});
