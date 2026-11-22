import { describe, it, expect, vi } from "vitest";
import { decryptTokenPair } from "../../../work/auth/token-cipher.js";
import { callbackRoute } from "./callback.js";
import { CONFIG, serve, testDeps } from "./auth-test-server.js";

const RETURN = "http://localhost:3000/auth/callback";
const ENCRYPTION_KEY = "0123456789abcdef".repeat(4);

async function signIn(deps: ReturnType<typeof testDeps>) {
  const state = await deps.handoffs.put("state", {
    returnUrl: RETURN,
    grant: null,
  });
  const res = await serve([callbackRoute(deps)]).inject(
    `/api/auth/callback?code=gh-code&state=${state}`,
  );

  return { res, location: new URL(res.headers.location as string) };
}

describe("GET /api/auth/callback", () => {
  it("sends a member back with a redeem code that carries every repo GitHub shows them", async () => {
    const deps = testDeps();
    const { res, location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );

    expect({
      status: res.statusCode,
      page: location.origin + location.pathname,
      redeemed,
    }).toEqual({
      status: 302,
      page: "http://localhost:3000/auth/callback",
      redeemed: {
        returnUrl: RETURN,
        grant: {
          githubId: 4242,
          login: "gedaiu",
          name: "Bogdan",
          avatarUrl: "https://a/1",
          scopes: ["admin"],
          repos: ["re-cinq/lore", "someone/else"],
        },
        generation: 0,
      },
    });
  });

  it("reads the person's generation before it asks GitHub for their membership and stores it on the redeem code's row", async () => {
    const asked: string[] = [];
    const deps = testDeps({
      github: {
        fetchOrgRole: async () => {
          asked.push("membership");

          return "member";
        },
      },
    });

    deps.query.mockImplementation(async (_sql: string, params: unknown[]) => {
      asked.push(`generation of ${params[0]}`);

      return { rows: [{ generation: 3 }] };
    });
    const { location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );

    expect({ asked, generation: redeemed?.generation }).toEqual({
      asked: ["generation of 4242", "membership"],
      generation: 3,
    });
  });

  it("gives a plain org member the admin scope too, until Lore has roles of its own", async () => {
    const deps = testDeps({ github: { fetchOrgRole: async () => "member" } });
    const { location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );

    expect(redeemed?.grant?.scopes).toEqual(["admin"]);
  });

  it("gives an org admin the admin scope", async () => {
    const deps = testDeps({ github: { fetchOrgRole: async () => "admin" } });
    const { location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );

    expect(redeemed?.grant?.scopes).toEqual(["admin"]);
  });

  it("sends a person outside the org back with auth_error=not_in_org", async () => {
    const { location } = await signIn(
      testDeps({ github: { fetchOrgRole: async () => null } }),
    );

    expect(location.searchParams.get("auth_error")).toBe("not_in_org");
  });

  it("sends a person back with auth_error=github_denied when the code exchange fails", async () => {
    const { location } = await signIn(
      testDeps({ github: { exchangeCode: async () => null } }),
    );

    expect(location.searchParams.get("auth_error")).toBe("github_denied");
  });

  it("sends a person back with auth_error=github_denied when the token answer has no expiry or no refresh token", async () => {
    const answers = [
      { accessToken: "ghu_a", refreshToken: "ghr_a" },
      { accessToken: "ghu_b", expiresIn: 0, refreshToken: "ghr_b" },
      { accessToken: "ghu_c", expiresIn: 28800 },
      "gho_bare_string",
    ];
    const errors: (string | null)[] = [];

    for (const answer of answers) {
      const { location } = await signIn(
        testDeps({ github: { exchangeCode: async () => answer as never } }),
      );

      errors.push(location.searchParams.get("auth_error"));
    }

    expect(errors).toEqual(answers.map(() => "github_denied"));
  });

  it("sends every GitHub account back with auth_error=not_in_org and stores no redeem row when no org is configured", async () => {
    const deps = testDeps({
      config: {
        clientId: "c",
        clientSecret: "s",
        apiUrl: "https://lore-api.example",
        uiUrl: undefined,
        org: undefined,
      },
    });
    const { location } = await signIn(deps);

    expect({
      authError: location.searchParams.get("auth_error"),
      code: location.searchParams.get("code"),
    }).toEqual({ authError: "not_in_org", code: null });
  });

  it("sends a person back with auth_error=github_denied when GitHub's viewer has no numeric id", async () => {
    const deps = testDeps({
      github: {
        fetchViewer: async () =>
          ({ login: "gedaiu", name: "B", avatar_url: "" }) as never,
      },
    });
    const { location } = await signIn(deps);

    expect({
      authError: location.searchParams.get("auth_error"),
      code: location.searchParams.get("code"),
    }).toEqual({ authError: "github_denied", code: null });
  });

  it("sends a person who cancelled on GitHub back with auth_error=github_denied", async () => {
    const exchanged = vi.fn();
    const deps = testDeps({ github: { exchangeCode: exchanged } });
    const state = await deps.handoffs.put("state", {
      returnUrl: RETURN,
      grant: null,
    });
    const res = await serve([callbackRoute(deps)]).inject(
      `/api/auth/callback?error=access_denied&state=${state}`,
    );

    expect({
      location: new URL(res.headers.location as string).searchParams.get(
        "auth_error",
      ),
      exchanged: exchanged.mock.calls.length,
    }).toEqual({ location: "github_denied", exchanged: 0 });
  });

  it("answers 400 for a state that was already used", async () => {
    const deps = testDeps();
    const state = await deps.handoffs.put("state", {
      returnUrl: RETURN,
      grant: null,
    });
    const server = serve([callbackRoute(deps)]);

    await server.inject(`/api/auth/callback?code=gh-code&state=${state}`);
    const second = await server.inject(
      `/api/auth/callback?code=gh-code&state=${state}`,
    );

    expect({
      status: second.statusCode,
      body: JSON.parse(second.payload),
    }).toEqual({
      status: 400,
      body: { error: "sign-in expired, start again" },
    });
  });

  it("encrypts the token pair onto the redeem handoff and leaves grant token-free", async () => {
    const pair = {
      accessToken: "ghu_access_tok",
      expiresIn: 28800,
      refreshToken: "ghr_refresh_tok",
      refreshTokenExpiresIn: 15897600,
    };
    const deps = testDeps({
      config: { ...CONFIG, tokenEncryptionKey: ENCRYPTION_KEY },
      github: { exchangeCode: async () => pair },
    });
    const { location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );
    const sealed = redeemed?.encryptedTokens ?? "";

    expect({
      grantHasToken: containsPair(
        JSON.stringify(redeemed?.grant ?? null),
        pair,
      ),
      leaksToken: containsPair(sealed, pair),
      decrypted: sealed ? decryptTokenPair(sealed, ENCRYPTION_KEY) : null,
    }).toEqual({
      grantHasToken: false,
      leaksToken: false,
      decrypted: pair,
    });
  });
});

function containsPair(
  text: string,
  pair: { accessToken: string; refreshToken: string },
): boolean {
  return text.includes(pair.accessToken) || text.includes(pair.refreshToken);
}
