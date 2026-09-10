import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { signRunCredential } from "@re-cinq/lore-shared/github-credential/run-credential.js";
import { handleGitCredential } from "./github-credentials.js";

const KEY = "run-credential-test-key";
const NOW = () => new Date("2026-09-10T17:00:00Z");

async function openVisit(repo: string) {
  const runs = new InMemoryAssemblyRuns();
  const assemblyRunId = await runs.start({
    blueprintName: "implementation-loop",
    repo,
  });
  const { stationRunId } = await runs.ensureStationRun({
    assemblyRunId,
    nodeId: "fix-ci",
    iteration: 1,
  });
  const credential = signRunCredential(
    { stationRunId, repo, expiresAt: "2026-09-10T18:00:00.000Z" },
    KEY,
  );

  return { runs, credential };
}

describe("handleGitCredential", () => {
  it("hands the open fix-ci visit a fresh token for re-cinq/bowman-ui as the git username/password pair", async () => {
    const { runs, credential } = await openVisit("re-cinq/bowman-ui");

    expect(
      await handleGitCredential(
        { runs, key: KEY, now: NOW, mint: async () => "ghs_fresh" },
        credential,
        { repo: "re-cinq/bowman-ui" },
      ),
    ).toEqual({
      code: 200,
      body: { username: "x-access-token", password: "ghs_fresh" },
    });
  });

  it("refuses a credential signed with another key with 401 bad-signature and mints nothing", async () => {
    const { runs } = await openVisit("re-cinq/bowman-ui");
    const forged = signRunCredential(
      {
        stationRunId: "any-run",
        repo: "re-cinq/bowman-ui",
        expiresAt: "2026-09-10T18:00:00.000Z",
      },
      "another-key",
    );
    const minted: string[] = [];
    const result = await handleGitCredential(
      {
        runs,
        key: KEY,
        now: NOW,
        mint: async (repo) => {
          minted.push(repo);

          return "ghs_leaked";
        },
      },
      forged,
      { repo: "re-cinq/bowman-ui" },
    );

    expect({ result, minted }).toEqual({
      result: { code: 401, body: { error: "bad-signature" } },
      minted: [],
    });
  });
});
