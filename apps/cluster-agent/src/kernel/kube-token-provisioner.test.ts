import { describe, it, expect } from "vitest";
import {
  GithubTokenMinter,
  KubeSecretKeyWriter,
} from "./kube-token-provisioner.js";

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
  // Verbatim from production, 2026-08-25 — the 409 lives only in the message.
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
    const writer = new KubeSecretKeyWriter("ai-agents", async () => core);

    await writer.setKey("agent-secrets", "GH_TOKEN_t1", "ghs_x");

    expect(replaced).toEqual([
      {
        existing: "a2VlcA==",
        GH_TOKEN_t1: Buffer.from("ghs_x").toString("base64"),
      },
    ]);
    // The retry re-READ first: it sends the winner's resourceVersion, not the
    // one it lost with. Replaying the stale version would lose the race forever.
    expect(versions).toEqual(["1", "2"]);
  });

  it("gives up after five conflicts rather than spinning", async () => {
    const { core } = fakeCore(Array(5).fill(proseConflict));
    const writer = new KubeSecretKeyWriter("ai-agents", async () => core);

    await expect(
      writer.setKey("agent-secrets", "GH_TOKEN_t1", "ghs_x"),
    ).rejects.toThrow(/HTTP-Code: 409/);
  });

  it("rethrows a refusal that is not a conflict on the first attempt", async () => {
    const { core } = fakeCore([
      Object.assign(new Error("forbidden"), { code: 403 }),
    ]);
    const writer = new KubeSecretKeyWriter("ai-agents", async () => core);

    await expect(
      writer.setKey("agent-secrets", "GH_TOKEN_t1", "ghs_x"),
    ).rejects.toMatchObject({ code: 403 });
  });
});
