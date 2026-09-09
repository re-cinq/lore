import { describe, it, expect } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeTokenProvisioner,
} from "./kube-token-provisioner.js";
import type { CatalogApi, SecretKeyWriter } from "./kube-token-provisioner.js";

describe("GithubTokenMinter", () => {
  it("returns the installation token for the repo", async () => {
    const minter = new GithubTokenMinter({
      getInstallationToken: async () => "ghs_realtoken",
    });

    expect(await minter.mint("re-cinq/lore")).toBe("ghs_realtoken");
  });

  it("throws naming the repo and the App vars when the token comes back empty", async () => {
    const minter = new GithubTokenMinter({
      getInstallationToken: async () => "",
    });

    await expect(minter.mint("re-cinq/lore")).rejects.toThrow(
      new Error(
        "minted an empty GitHub token for re-cinq/lore — check GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID",
      ),
    );
  });
});

describe("KubeSecretKeyWriter", () => {
  const proseConflict = new Error(
    'HTTP-Code: 409\nMessage: Unknown API Status Code!\nBody: "{\\"reason\\":\\"Conflict\\",\\"code\\":409}"',
  );

  function fakeCore(failures: Error[]) {
    const replaced: Array<Record<string, string>> = [];
    const versions: string[] = [];
    let version = 1;
    const core = {
      readNamespacedSecret: async () => ({
        metadata: { resourceVersion: `${version++}` },
        data: { existing: "a2VlcA==" },
      }),
      replaceNamespacedSecret: async ({
        body,
      }: {
        body: {
          metadata?: { resourceVersion?: string };
          data?: Record<string, string>;
        };
      }) => {
        versions.push(body.metadata?.resourceVersion ?? "none");
        const failure = failures.shift();

        if (failure) {
          throw failure;
        }
        replaced.push(body.data ?? {});
      },
    };

    return { core, replaced, versions };
  }

  it("retries the replace when the lost race arrives as a prose-only 409", async () => {
    const { core, replaced, versions } = fakeCore([proseConflict]);
    const writer = new KubeSecretKeyWriter("ai-agents", () => core);

    await writer.setKey("agent-secrets", "GH_TOKEN_t1", "ghs_x");

    expect(replaced).toEqual([
      {
        existing: "a2VlcA==",
        GH_TOKEN_t1: Buffer.from("ghs_x").toString("base64"),
      },
    ]);
    expect(versions).toEqual(["1", "2"]);
  });

  it("gives up after five conflicts rather than spinning", async () => {
    const { core } = fakeCore(Array(5).fill(proseConflict));
    const writer = new KubeSecretKeyWriter("ai-agents", () => core);

    await expect(
      writer.setKey("agent-secrets", "GH_TOKEN_t1", "ghs_x"),
    ).rejects.toThrow(/HTTP-Code: 409/);
  });

  it("rethrows a refusal that is not a conflict on the first attempt", async () => {
    const { core } = fakeCore([
      Object.assign(new Error("forbidden"), { code: 403 }),
    ]);
    const writer = new KubeSecretKeyWriter("ai-agents", () => core);

    await expect(
      writer.setKey("agent-secrets", "GH_TOKEN_t1", "ghs_x"),
    ).rejects.toMatchObject({ code: 403 });
  });
});

describe("KubeTokenProvisioner.provision", () => {
  const SPEC = {
    taskId: "task-77",
    taskType: "implementation",
    description: "d",
    prompt: "p",
    targetRepo: "re-cinq/lore",
    branch: "lore/task-77",
  } as unknown as LoreTaskSpec;

  function catalogFor(opts?: {
    onApplyAgentDefinition?: () => never;
    onApplyStation?: () => never;
  }) {
    const named = (name: string) => ({
      metadata: { name },
      spec: { prompt: "do the thing", model: "claude-fable-5" },
    });
    const applied: string[] = [];
    const deleted: string[] = [];

    return {
      applied,
      deleted,
      catalog: {
        getAgentDefinition: async () => named("implementation"),
        getStation: async () => named("implementation"),
        applyAgentDefinition: async (def: { metadata?: { name?: string } }) => {
          opts?.onApplyAgentDefinition?.();
          applied.push(`def:${def.metadata?.name}`);
        },
        applyStation: async (station: { metadata?: { name?: string } }) => {
          opts?.onApplyStation?.();
          applied.push(`station:${station.metadata?.name}`);
        },
        deleteAgentDefinition: async () => {
          deleted.push("def:pt-task-77");
        },
        deleteStation: async () => {
          deleted.push("station:pt-task-77");
        },
      } as unknown as CatalogApi,
    };
  }

  function secretsSpy() {
    const keys = new Map<string, string>();

    return {
      keys,
      secrets: {
        setKey: async (_s: string, key: string, value: string) => {
          keys.set(key, value);
        },
        deleteKey: async (_s: string, key: string) => {
          keys.delete(key);
        },
      } as SecretKeyWriter,
    };
  }

  it("leaves no token or AgentDefinition behind when applyStation fails", async () => {
    const { keys, secrets } = secretsSpy();
    const { catalog, deleted } = catalogFor({
      onApplyStation: () => {
        throw new Error("apiserver refused the Station");
      },
    });
    const provisioner = new KubeTokenProvisioner(
      { mint: async () => "ghs_token" },
      secrets,
      catalog,
    );

    await expect(provisioner.provision(SPEC)).rejects.toThrow(
      /apiserver refused the Station/,
    );
    expect([...keys.keys()]).toEqual([]);
    expect(deleted.sort()).toEqual(["def:pt-task-77", "station:pt-task-77"]);
  });

  it("leaves no token behind when applyAgentDefinition cannot be applied", async () => {
    const { keys, secrets } = secretsSpy();
    const { catalog, deleted } = catalogFor({
      onApplyAgentDefinition: () => {
        throw new Error("apiserver refused the AgentDefinition");
      },
    });
    const provisioner = new KubeTokenProvisioner(
      { mint: async () => "ghs_token" },
      secrets,
      catalog,
    );

    await expect(provisioner.provision(SPEC)).rejects.toThrow(
      /apiserver refused the AgentDefinition/,
    );
    expect([...keys.keys()]).toEqual([]);
    expect(deleted.sort()).toEqual(["def:pt-task-77", "station:pt-task-77"]);
  });

  it("keeps the token, keyed by task, when the pair lands", async () => {
    const { keys, secrets } = secretsSpy();
    const { catalog } = catalogFor();
    const provisioner = new KubeTokenProvisioner(
      { mint: async () => "ghs_token" },
      secrets,
      catalog,
    );

    expect(await provisioner.provision(SPEC)).toBe("pt-task-77");
    expect([...keys.entries()]).toEqual([
      [expect.stringContaining("task-77"), "ghs_token"],
    ]);
  });
});

describe("KubeTokenProvisioner.provision write order", () => {
  it("applies the Station before the AgentDefinition, matching applyCatalogPair's invariant", async () => {
    const named = (name: string) => ({
      metadata: { name },
      spec: { prompt: "do the thing", model: "claude-fable-5" },
    });
    const applied: string[] = [];
    const catalog = {
      getAgentDefinition: async () => named("implementation"),
      getStation: async () => named("implementation"),
      applyAgentDefinition: async (def: { metadata?: { name?: string } }) => {
        applied.push(`def:${def.metadata?.name}`);
      },
      applyStation: async (station: { metadata?: { name?: string } }) => {
        applied.push(`station:${station.metadata?.name}`);
      },
      deleteAgentDefinition: async () => {},
      deleteStation: async () => {},
    } as unknown as CatalogApi;
    const provisioner = new KubeTokenProvisioner(
      { mint: async () => "ghs_token" },
      {
        setKey: async () => {},
        deleteKey: async () => {},
      } as SecretKeyWriter,
      catalog,
    );

    await provisioner.provision({
      taskId: "task-77",
      taskType: "implementation",
      description: "d",
      prompt: "p",
      targetRepo: "re-cinq/lore",
      branch: "lore/task-77",
    } as unknown as LoreTaskSpec);

    expect(applied).toEqual(["station:pt-task-77", "def:pt-task-77"]);
  });
});
