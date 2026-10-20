import { describe, expect, it } from "vitest";
import { ingestSecretRepair } from "./ingest-secret-repair.js";

function scene(failuresByRepo: Record<string, string[]> = {}) {
  const logged: string[] = [];
  const configured: string[] = [];
  const deps = {
    repos: () => Promise.resolve(["o/a", "o/b"]),
    configure: (repo: string) => {
      configured.push(repo);

      return Promise.resolve(failuresByRepo[repo] ?? []);
    },
    log: (line: string) => logged.push(line),
  };

  return { deps, logged, configured };
}

describe("ingestSecretRepair", () => {
  it("configures every onboarded repo and reports all repaired when none fails", async () => {
    const { deps, configured } = scene();

    const summary = await ingestSecretRepair(deps);

    expect({ configured, summary }).toEqual({
      configured: ["o/a", "o/b"],
      summary: "ingest secret repair: 2 repaired, 0 failed",
    });
  });

  it("logs a repo's failures and still repairs the repo after it", async () => {
    const { deps, configured, logged } = scene({
      "o/a": ["the `LORE_INGEST_TOKEN` repo secret could not be set: 403"],
    });

    const summary = await ingestSecretRepair(deps);

    expect({ configured, summary, logged }).toEqual({
      configured: ["o/a", "o/b"],
      summary: "ingest secret repair: 1 repaired, 1 failed",
      logged: [
        "o/a: the `LORE_INGEST_TOKEN` repo secret could not be set: 403",
      ],
    });
  });

  it("counts a repo whose configure call throws as failed and goes on", async () => {
    const { deps, logged } = scene();
    const throwing = {
      ...deps,
      configure: (repo: string) =>
        repo === "o/a"
          ? Promise.reject(new Error("no installation"))
          : Promise.resolve([]),
    };

    const summary = await ingestSecretRepair(throwing);

    expect({ summary, logged }).toEqual({
      summary: "ingest secret repair: 1 repaired, 1 failed",
      logged: ["o/a: no installation"],
    });
  });
});
