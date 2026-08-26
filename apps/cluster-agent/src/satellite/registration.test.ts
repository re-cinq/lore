import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore } from "./identity-store.js";
import {
  REGISTRATION_MAX_DELAY_MS,
  nextRegistrationDelay,
  parseTags,
  registerOnce,
  registerWithBackoff,
  registrationConfig,
} from "./registration.js";

const FULL_ENV = {
  LORE_API_URL: "https://lore-api.example.com",
  LORE_CLUSTER_AGENT_REGISTRATION_TOKEN: "reg-token",
  LORE_CLUSTER_AGENT_NAME: "minikube-bogdan",
};

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: Array<Response | Error>): {
  fetchFn: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? new Error("fake fetch exhausted");

    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as typeof fetch;

  return { fetchFn, calls };
}

describe("registrationConfig", () => {
  it("returns null when LORE_API_URL is unset", () => {
    expect(
      registrationConfig({ ...FULL_ENV, LORE_API_URL: undefined }),
    ).toBeNull();
  });

  it("returns null when LORE_CLUSTER_AGENT_REGISTRATION_TOKEN is unset", () => {
    expect(
      registrationConfig({
        ...FULL_ENV,
        LORE_CLUSTER_AGENT_REGISTRATION_TOKEN: undefined,
      }),
    ).toBeNull();
  });

  it("returns null when LORE_CLUSTER_AGENT_NAME is unset", () => {
    expect(
      registrationConfig({ ...FULL_ENV, LORE_CLUSTER_AGENT_NAME: undefined }),
    ).toBeNull();
  });

  it("builds the config with empty tags when LORE_CLUSTER_AGENT_TAGS is unset", () => {
    expect(registrationConfig(FULL_ENV)).toEqual({
      apiUrl: "https://lore-api.example.com",
      registrationToken: "reg-token",
      name: "minikube-bogdan",
      tags: [],
    });
  });

  it("strips a trailing slash from LORE_API_URL", () => {
    expect(
      registrationConfig({
        ...FULL_ENV,
        LORE_API_URL: "https://lore-api.example.com/",
      })?.apiUrl,
    ).toBe("https://lore-api.example.com");
  });
});

describe("parseTags", () => {
  it("splits comma-separated tags and trims whitespace", () => {
    expect(parseTags("node:agent, node:validate ,gpu")).toEqual([
      "node:agent",
      "node:validate",
      "gpu",
    ]);
  });

  it("drops empty entries so a trailing comma adds no tag", () => {
    expect(parseTags("gpu,,")).toEqual(["gpu"]);
  });
});

describe("nextRegistrationDelay", () => {
  it("doubles 30s to 60s", () => {
    expect(nextRegistrationDelay(30_000)).toBe(60_000);
  });

  it("caps the schedule at 5 minutes", () => {
    expect(nextRegistrationDelay(240_000)).toBe(REGISTRATION_MAX_DELAY_MS);
    expect(nextRegistrationDelay(REGISTRATION_MAX_DELAY_MS)).toBe(
      REGISTRATION_MAX_DELAY_MS,
    );
  });
});

describe("registerOnce", () => {
  const config = {
    apiUrl: "https://lore-api.example.com",
    registrationToken: "reg-token",
    name: "minikube-bogdan",
    tags: ["node:agent"],
  };

  it("posts name, tags and cluster_info under the registration bearer token", async () => {
    const { fetchFn, calls } = fakeFetch([
      jsonResponse(200, { id: "id-1", token: "tok-1" }),
    ]);

    await registerOnce({ config, store: new InMemoryIdentityStore(), fetchFn });

    expect(calls[0].url).toBe(
      "https://lore-api.example.com/api/cluster-agents/register",
    );
    expect(calls[0].init.headers).toMatchObject({
      authorization: "Bearer reg-token",
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: "minikube-bogdan",
      tags: ["node:agent"],
      cluster_info: null,
    });
  });

  it("includes current_token when an identity is already persisted", async () => {
    const { fetchFn, calls } = fakeFetch([
      jsonResponse(200, { id: "id-1", token: "tok-2" }),
    ]);
    const store = new InMemoryIdentityStore({ id: "id-1", token: "tok-1" });

    await registerOnce({ config, store, fetchFn });

    expect(
      JSON.parse(calls[0].init.body as string) as { current_token?: string },
    ).toMatchObject({ current_token: "tok-1" });
  });

  it("persists and returns {id, token} from a 200 response", async () => {
    const { fetchFn } = fakeFetch([
      jsonResponse(200, { id: "id-7", token: "tok-7", name: "x", tags: [] }),
    ]);
    const store = new InMemoryIdentityStore();

    expect(await registerOnce({ config, store, fetchFn })).toEqual({
      id: "id-7",
      token: "tok-7",
    });
    expect(await store.load()).toEqual({ id: "id-7", token: "tok-7" });
  });

  it("returns null and persists nothing on a 409 refusal", async () => {
    const { fetchFn } = fakeFetch([jsonResponse(409, { error: "taken" })]);
    const store = new InMemoryIdentityStore();

    expect(await registerOnce({ config, store, fetchFn })).toBeNull();
    expect(await store.load()).toBeNull();
  });

  it("returns null when the fetch itself rejects", async () => {
    const { fetchFn } = fakeFetch([new Error("ECONNREFUSED")]);

    expect(
      await registerOnce({
        config,
        store: new InMemoryIdentityStore(),
        fetchFn,
      }),
    ).toBeNull();
  });
});

describe("registerWithBackoff", () => {
  it("retries on the 30s-doubling schedule until registration succeeds", async () => {
    const { fetchFn } = fakeFetch([
      new Error("ECONNREFUSED"),
      jsonResponse(503, { error: "db unavailable" }),
      jsonResponse(200, { id: "id-3", token: "tok-3" }),
    ]);
    const sleeps: number[] = [];
    const identity = await registerWithBackoff({
      config: {
        apiUrl: "https://lore-api.example.com",
        registrationToken: "reg-token",
        name: "minikube-bogdan",
        tags: [],
      },
      store: new InMemoryIdentityStore(),
      fetchFn,
      sleep: (ms) => {
        sleeps.push(ms);

        return Promise.resolve();
      },
    });

    expect(identity).toEqual({ id: "id-3", token: "tok-3" });
    expect(sleeps).toEqual([30_000, 60_000]);
  });
});
