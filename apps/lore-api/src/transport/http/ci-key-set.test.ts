import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, expect, it } from "vitest";
import { fetchKeySet, findKey } from "./ci-key-set.js";

const ISSUER = "https://ghe.example.com/_services/token";

function stubFetch(jwksUri: string, fetched: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);

    fetched.push(url);

    return new Response(
      JSON.stringify(
        url.endsWith("/openid-configuration")
          ? { jwks_uri: jwksUri }
          : { keys: [{ kid: "k1" }] },
      ),
    );
  }) as typeof fetch;
}

describe("fetchKeySet", () => {
  it("fetches the key set only from the configured issuer origin", async () => {
    const results: Record<string, unknown> = {};

    for (const [name, uri] of [
      ["same", "https://ghe.example.com/.well-known/jwks"],
      ["foreign", "https://foreign.example.com/jwks"],
      ["downgrade", "http://ghe.example.com/.well-known/jwks"],
    ]) {
      const fetched: string[] = [];

      results[name] = await fetchKeySet(ISSUER, stubFetch(uri, fetched)).then(
        (keys) => ({ keys: keys.length, fetched: fetched.includes(uri) }),
        () => ({ refused: true, fetched: fetched.includes(uri) }),
      );
    }

    expect(results).toEqual({
      same: { keys: 1, fetched: true },
      foreign: { refused: true, fetched: false },
      downgrade: { refused: true, fetched: false },
    });
  });
});

describe("findKey", () => {
  it("shares one fetch between concurrent lookups and serves later ones from the cache", async () => {
    const fetched: string[] = [];
    const doFetch = stubFetch("https://ghe.example.com/jwks", fetched);
    const issuer = "https://ghe.example.com/_services/token";

    const found = await Promise.all([
      findKey(issuer, "k1", doFetch),
      findKey(issuer, "k1", doFetch),
    ]);
    const cached = await findKey(issuer, "k1", doFetch);
    const unknown = await findKey(issuer, "nope", doFetch);

    expect({
      kids: [...found, cached].map((jwk) => jwk?.kid),
      unknown,
      fetches: fetched.filter((url) => url.endsWith("/jwks")).length,
    }).toEqual({ kids: ["k1", "k1", "k1"], unknown: undefined, fetches: 1 });
  });
});

describe("findKey refusals", () => {
  it("refuses a key set the issuer origin redirects to another host", async () => {
    const issuer = "https://ghe-redirect.example.com/_services/token";
    const foreign = "https://foreign.example.com/jwks";
    const fetched: string[] = [];
    const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/openid-configuration")) {
        return new Response(
          JSON.stringify({ jwks_uri: "https://ghe-redirect.example.com/jwks" }),
        );
      }
      enforceTrue(init?.redirect !== "error", TypeError, "redirect refused");

      if (init?.redirect === "manual") {
        return new Response(null, {
          status: 302,
          headers: { location: foreign },
        });
      }
      fetched.push(foreign);

      return new Response(JSON.stringify({ keys: [{ kid: "evil" }] }));
    }) as typeof fetch;

    const outcome = await findKey(issuer, "evil", doFetch).then(
      (jwk) => ({ kid: jwk?.kid, foreignFetched: fetched.includes(foreign) }),
      () => ({ kid: undefined, foreignFetched: fetched.includes(foreign) }),
    );

    expect(outcome).toEqual({ kid: undefined, foreignFetched: false });
  });
});

describe("findKey deadline", () => {
  it("rejects when the issuer never answers and lets the next lookup fetch afresh", async () => {
    const issuer = "https://ghe-hang.example.com/_services/token";
    const hangs = (() => new Promise<Response>(() => {})) as typeof fetch;

    const hung = await findKey(issuer, "k1", hangs, 20).then(
      () => "answered",
      () => "rejected",
    );
    const next = await findKey(
      issuer,
      "k1",
      stubFetch("https://ghe-hang.example.com/jwks", []),
    );

    expect({ hung, next: next?.kid }).toEqual({ hung: "rejected", next: "k1" });
  });
});

describe("findKey refuses what is not the issuer's key set", () => {
  it("refuses when the issuer's own origin answers something that is not a key set", async () => {
    const answering = (jwksBody: string) =>
      (async (input: RequestInfo | URL) =>
        new Response(
          String(input).endsWith("/openid-configuration")
            ? JSON.stringify({ jwks_uri: "https://ghe-junk.example.com/jwks" })
            : jwksBody,
        )) as typeof fetch;
    const lookup = (jwksBody: string) =>
      findKey(
        "https://ghe-junk.example.com/_services/token",
        "k1",
        answering(jwksBody),
      ).then(
        (jwk) => jwk?.kid ?? "refused",
        () => "refused",
      );

    expect({
      keysNotArray: await lookup(JSON.stringify({ keys: "k1" })),
      keysAnObject: await lookup(JSON.stringify({ keys: { kid: "k1" } })),
      nullBody: await lookup("null"),
      htmlPage: await lookup("<html>"),
    }).toEqual({
      keysNotArray: "refused",
      keysAnObject: "refused",
      nullBody: "refused",
      htmlPage: "refused",
    });
  });

  it("refuses an openid configuration whose jwks_uri is missing, not a URL or names another host through userinfo", async () => {
    const fetched: string[] = [];
    const configuring = (config: Record<string, unknown>) =>
      (async (input: RequestInfo | URL) => {
        const url = String(input);

        fetched.push(url);

        return new Response(
          JSON.stringify(
            url.endsWith("/openid-configuration")
              ? config
              : { keys: [{ kid: "k1" }] },
          ),
        );
      }) as typeof fetch;
    const lookup = (config: Record<string, unknown>) =>
      findKey(
        "https://ghe-config.example.com/_services/token",
        "k1",
        configuring(config),
      ).then(
        (jwk) => jwk?.kid ?? "refused",
        () => "refused",
      );

    expect({
      missing: await lookup({}),
      numeric: await lookup({ jwks_uri: 42 }),
      prose: await lookup({ jwks_uri: "not a url" }),
      relative: await lookup({ jwks_uri: "/.well-known/jwks" }),
      userinfo: await lookup({
        jwks_uri: "https://ghe-config.example.com@foreign.example.com/jwks",
      }),
      fetchedOnlyConfig: fetched.every((url) =>
        url.endsWith("/openid-configuration"),
      ),
    }).toEqual({
      missing: "refused",
      numeric: "refused",
      prose: "refused",
      relative: "refused",
      userinfo: "refused",
      fetchedOnlyConfig: true,
    });
  });

  it("never answers one issuer's lookup with another issuer's keys, kept or in flight", async () => {
    const keysOf = (url: string) =>
      url.startsWith("https://ghe-a.example.com") ? "a-key" : "b-key";
    const doFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const origin = new URL(url).origin;

      return new Response(
        JSON.stringify(
          url.endsWith("/openid-configuration")
            ? { jwks_uri: `${origin}/jwks` }
            : { keys: [{ kid: keysOf(url) }] },
        ),
      );
    }) as typeof fetch;
    const issuerA = "https://ghe-a.example.com/_services/token";
    const issuerB = "https://ghe-b.example.com/_services/token";

    const concurrent = await Promise.all([
      findKey(issuerA, "a-key", doFetch),
      findKey(issuerB, "a-key", doFetch),
    ]);
    const kept = await findKey(issuerB, "a-key", doFetch);

    expect({
      concurrent: concurrent.map((jwk) => jwk?.kid),
      kept: kept?.kid,
    }).toEqual({ concurrent: ["a-key", undefined], kept: undefined });
  });
});
