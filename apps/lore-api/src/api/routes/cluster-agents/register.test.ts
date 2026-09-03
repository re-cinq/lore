import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import { handleRegister } from "./register.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";

const REG_TOKEN = "reg-secret";

const deps = (repository = new InMemoryClusterAgents()) => ({
  repository,
  registrationToken: REG_TOKEN,
});

describe("handleRegister", () => {
  it("rejects 401 without the registration token", async () => {
    expect(
      await handleRegister(deps(), undefined, {
        name: "minikube",
        tags: [],
        cluster_info: null,
      }),
    ).toEqual({ code: 401, body: { error: "unauthorized" } });
    expect(
      await handleRegister(deps(), "wrong", {
        name: "minikube",
        tags: [],
        cluster_info: null,
      }),
    ).toMatchObject({ code: 401 });
  });

  it("rejects 401 when no registration token is configured, even on a match", async () => {
    expect(
      await handleRegister(
        {
          repository: new InMemoryClusterAgents(),
          registrationToken: undefined,
        },
        undefined,
        { name: "minikube", tags: [], cluster_info: null },
      ),
    ).toMatchObject({ code: 401 });
  });

  it("registers a new name and serves the plaintext token exactly once", async () => {
    const repository = new InMemoryClusterAgents();

    const result = await handleRegister(deps(repository), REG_TOKEN, {
      name: "minikube",
      tags: ["node:agent", "gpu"],
      cluster_info: { k8s_version: "1.30" },
    });

    expect(result.code).toBe(200);

    enforceTrue(result.code === 200, Error, "unreachable");
    expect(result.body).toMatchObject({
      name: "minikube",
      tags: ["node:agent", "gpu"],
    });
    expect(result.body.token).toMatch(/^lca_/);
    const stored = await repository.findByName("minikube");

    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toContain(result.body.token);
  });

  it("re-registering a known name with the current token keeps it under the same id", async () => {
    const repository = new InMemoryClusterAgents();
    const first = await handleRegister(deps(repository), REG_TOKEN, {
      name: "minikube",
      tags: ["node:agent"],
      cluster_info: null,
    });

    enforceTrue(first.code === 200, Error, "unreachable");
    const second = await handleRegister(deps(repository), REG_TOKEN, {
      name: "minikube",
      tags: ["node:agent", "gpu"],
      cluster_info: null,
      current_token: first.body.token,
    });

    enforceTrue(second.code === 200, Error, "unreachable");
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.token).toBe(first.body.token);
    expect((await repository.list()).length).toBe(1);
    expect((await repository.findByName("minikube"))?.tags).toEqual([
      "node:agent",
      "gpu",
    ]);
  });

  it("rejects 409 when a known name re-registers without its current token", async () => {
    const repository = new InMemoryClusterAgents();

    await handleRegister(deps(repository), REG_TOKEN, {
      name: "minikube",
      tags: [],
      cluster_info: null,
    });

    expect(
      await handleRegister(deps(repository), REG_TOKEN, {
        name: "minikube",
        tags: [],
        cluster_info: null,
      }),
    ).toEqual({
      code: 409,
      body: { error: "name is registered to a live identity" },
    });
    expect(
      await handleRegister(deps(repository), REG_TOKEN, {
        name: "minikube",
        tags: [],
        cluster_info: null,
        current_token: "lca_stolen",
      }),
    ).toMatchObject({ code: 409 });
  });

  it("rejects 409 when a concurrent registration takes the name after findByName", async () => {
    const repository = new InMemoryClusterAgents();
    let releaseFind = () => {};
    const findGate = new Promise<void>((resolve) => {
      releaseFind = resolve;
    });
    const racingRepository = new Proxy(repository, {
      get(target, prop, receiver) {
        if (prop === "findByName") {
          return async (name: string) => {
            await findGate;

            return target.findByName(name);
          };
        }

        return Reflect.get(target, prop, receiver);
      },
    });

    const body = { name: "minikube", tags: [], cluster_info: null };
    const both = Promise.all([
      handleRegister(deps(racingRepository), REG_TOKEN, body),
      handleRegister(deps(racingRepository), REG_TOKEN, body),
    ]);

    releaseFind();
    const codes = (await both).map((result) => result.code).sort();

    expect(codes).toEqual([200, 409]);
  });
});
