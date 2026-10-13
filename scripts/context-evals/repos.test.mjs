import { test } from "node:test";
import assert from "node:assert/strict";
import { reposToEvaluate } from "./repos.mjs";

const ENV = { LORE_API_URL: "https://lore.example", LORE_INGEST_TOKEN: "tok" };

function loreApi(repos) {
  return async () => Response.json({ repos, total: repos.length });
}

test("lists every repository whose onboarding pull request merged", async () => {
  const fetchFn = loreApi([
    { full_name: "re-cinq/lore", onboarding_pr_merged: true },
    { full_name: "re-cinq/lore-sandbox", onboarding_pr_merged: false },
    { full_name: "re-cinq/Otto", onboarding_pr_merged: true },
  ]);

  assert.deepEqual(await reposToEvaluate({ env: ENV, fetchFn }), [
    "re-cinq/lore",
    "re-cinq/Otto",
  ]);
});

test("evaluates only re-cinq/Otto when the run names it, without asking Lore", async () => {
  const fetchFn = async () => {
    throw new Error("not asked");
  };

  assert.deepEqual(
    await reposToEvaluate({ env: ENV, fetchFn, only: "re-cinq/Otto" }),
    ["re-cinq/Otto"],
  );
});

test("refuses a repository name that is not owner/name", async () => {
  await assert.rejects(
    reposToEvaluate({ env: ENV, fetchFn: loreApi([]), only: "lore; rm -rf" }),
    new Error('"lore; rm -rf" is not an owner/name repository'),
  );
});
