import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { signRunCredential } from "@re-cinq/lore-shared/github-credential/run-credential.js";
import { handleGitCredential } from "./github-credentials.js";

const KEY = "run-credential-test-key";
const NOW = () => new Date("2026-09-10T17:00:00Z");
const REPO = "re-cinq/bowman-ui";

async function fixCiVisit(key = KEY) {
  const runs = new InMemoryAssemblyRuns();
  const assemblyRunId = await runs.start({
    blueprintName: "implementation-loop",
    repo: REPO,
  });
  const { nodeRowId, stationRunId } = await runs.ensureStationRun({
    assemblyRunId,
    nodeId: "fix-ci",
    iteration: 1,
  });
  const credential = signRunCredential(
    { stationRunId, repo: REPO, expiresAt: "2026-09-10T18:00:00.000Z" },
    key,
  );

  return { runs, nodeRowId, credential };
}

async function ask(runs: InMemoryAssemblyRuns, credential: string) {
  const minted: string[] = [];
  const result = await handleGitCredential(
    {
      runs,
      key: KEY,
      now: NOW,
      mint: async (repo) => {
        minted.push(repo);

        return "ghs_fresh";
      },
    },
    credential,
    { repo: REPO },
  );

  return { result, minted };
}

describe("handleGitCredential", () => {
  it("hands the open fix-ci visit a fresh token for re-cinq/bowman-ui as the git username/password pair", async () => {
    const { runs, credential } = await fixCiVisit();

    expect(await ask(runs, credential)).toEqual({
      result: {
        code: 200,
        body: { username: "x-access-token", password: "ghs_fresh" },
      },
      minted: [REPO],
    });
  });

  it("refuses a credential signed with another key with 401 bad-signature and mints nothing", async () => {
    const { runs, credential } = await fixCiVisit("another-key");

    expect(await ask(runs, credential)).toEqual({
      result: { code: 401, body: { error: "bad-signature" } },
      minted: [],
    });
  });

  it("refuses the fix-ci visit that already finished with 403 run-closed and mints nothing", async () => {
    const { runs, nodeRowId, credential } = await fixCiVisit();

    await runs.finishStationRunOnce(nodeRowId, "changes_requested");

    expect(await ask(runs, credential)).toEqual({
      result: { code: 403, body: { error: "run-closed" } },
      minted: [],
    });
  });
});
