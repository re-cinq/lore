import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore } from "./identity-store.js";
import {
  REGISTRATION_MAX_DELAY_MS,
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
  it("refuses to boot when LORE_API_URL is unset, naming it", () => {
    expect(() =>
      registrationConfig({ ...FULL_ENV, LORE_API_URL: undefined }),
    ).toThrow(/LORE_API_URL/);
  });

  it("refuses to boot when LORE_CLUSTER_AGENT_REGISTRATION_TOKEN is unset, naming it", () => {
    expect(() =>
      registrationConfig({
        ...FULL_ENV,
        LORE_CLUSTER_AGENT_REGISTRATION_TOKEN: undefined,
      }),
    ).toThrow(/LORE_CLUSTER_AGENT_REGISTRATION_TOKEN/);
  });

  it("refuses to boot when LORE_CLUSTER_AGENT_NAME is unset, naming it", () => {
    expect(() =>
      registrationConfig({ ...FULL_ENV, LORE_CLUSTER_AGENT_NAME: undefined }),
    ).toThrow(/LORE_CLUSTER_AGENT_NAME/);
  });

  it("names every missing variable at once, not just the first", () => {
    // An operator fixing one variable per crash-loop is an operator restarting
    // the pod three times to learn three names it could have said at once.
    expect(() => registrationConfig({})).toThrow(
      /LORE_API_URL, LORE_CLUSTER_AGENT_REGISTRATION_TOKEN, LORE_CLUSTER_AGENT_NAME/,
    );
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
      }).apiUrl,
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

  it("publishes the minted token as the run pods' telemetry credential", async () => {
    const { fetchFn } = fakeFetch([
      jsonResponse(200, { id: "id-7", token: "tok-7" }),
    ]);
    const published: string[] = [];

    await registerOnce({
      config,
      store: new InMemoryIdentityStore(),
      fetchFn,
      publishTelemetryCredential: async (id) => {
        published.push(id.token);
      },
    });

    expect(published).toEqual(["tok-7"]);
  });

  it("republishes on rotation, so the pods' copy never outlives its token", async () => {
    // The rotated token is what the Floor's sink will accept; leaving the old
    // one in the Secret would 401 every event after a rotation.
    const { fetchFn } = fakeFetch([
      jsonResponse(200, { id: "id-7", token: "tok-rotated" }),
    ]);
    const store = new InMemoryIdentityStore({ id: "id-7", token: "tok-old" });
    const published: string[] = [];

    await registerOnce({
      config,
      store,
      fetchFn,
      publishTelemetryCredential: async (id) => {
        published.push(id.token);
      },
    });

    expect(published).toEqual(["tok-rotated"]);
  });

  it("publishes nothing when registration is refused", async () => {
    const { fetchFn } = fakeFetch([jsonResponse(409, { error: "taken" })]);
    const published: string[] = [];

    await registerOnce({
      config,
      store: new InMemoryIdentityStore(),
      fetchFn,
      publishTelemetryCredential: async (id) => {
        published.push(id.token);
      },
    });

    expect(published).toEqual([]);
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

  it("caps the retry schedule at 5 minutes and keeps polling there", async () => {
    const { fetchFn } = fakeFetch([
      ...Array.from({ length: 6 }, () => jsonResponse(503, { error: "down" })),
      jsonResponse(200, { id: "id-9", token: "tok-9" }),
    ]);
    const sleeps: number[] = [];

    await registerWithBackoff({
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

    expect(sleeps).toEqual([
      30_000,
      60_000,
      120_000,
      240_000,
      REGISTRATION_MAX_DELAY_MS,
      REGISTRATION_MAX_DELAY_MS,
    ]);
  });
});

describe("registerOnce never throws", () => {
  const config = {
    apiUrl: "https://lore-api.example.com",
    registrationToken: "reg-token",
    name: "minikube-bogdan",
    tags: [],
  };

  it("returns null when a 200 carries a body that is not JSON", async () => {
    const { fetchFn } = fakeFetch([
      {
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      } as unknown as Response,
    ]);
    const store = new InMemoryIdentityStore();

    expect(await registerOnce({ config, store, fetchFn })).toBeNull();
    expect(await store.load()).toBeNull();
  });

  it("returns null when the 200 body lacks an id or a token", async () => {
    const { fetchFn } = fakeFetch([jsonResponse(200, { id: "id-1" })]);
    const store = new InMemoryIdentityStore();

    expect(await registerOnce({ config, store, fetchFn })).toBeNull();
    expect(await store.load()).toBeNull();
  });

  it("returns null when the identity store cannot be read", async () => {
    const { fetchFn, calls } = fakeFetch([]);
    const store = {
      load: () => Promise.reject(new Error("secrets is forbidden")),
      save: () => Promise.resolve(),
    };

    expect(await registerOnce({ config, store, fetchFn })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("keeps the persisted identity when only the telemetry publish fails", async () => {
    // The store is written BEFORE the credential is published, so this attempt
    // answers null while the identity is already saved. That is the recovery
    // path, not a leak: the next attempt presents it as `current_token`, the
    // server recognises the holder, and the publish is retried.
    const { fetchFn } = fakeFetch([
      jsonResponse(200, { id: "id-1", token: "tok-1" }),
    ]);
    const store = new InMemoryIdentityStore();

    expect(
      await registerOnce({
        config,
        store,
        fetchFn,
        publishTelemetryCredential: () => Promise.reject(new Error("EROFS")),
      }),
    ).toBeNull();
    expect(await store.load()).toEqual({ id: "id-1", token: "tok-1" });
  });

  it("returns null when the minted identity cannot be persisted", async () => {
    const { fetchFn } = fakeFetch([
      jsonResponse(200, { id: "id-1", token: "tok-1" }),
    ]);
    const store = {
      load: () => Promise.resolve(null),
      save: () => Promise.reject(new Error("EROFS")),
    };

    expect(await registerOnce({ config, store, fetchFn })).toBeNull();
  });
});
