import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

// All workflows that deploy a service image into the umbrella Helm release via
// deploy-lore-platform.sh.  A libs/shared or deploy-lore-platform.sh change
// triggers ALL of them at once; their deploy steps then race for the Helm
// release lock.
const UMBRELLA_DEPLOY_WORKFLOWS = [
  ".github/workflows/build-floor.yml",
  ".github/workflows/build-mcp-server.yml",
  ".github/workflows/build-lore-api.yml",
  ".github/workflows/build-event-router.yml",
  ".github/workflows/build-stations.yml",
  ".github/workflows/build-cluster-agent.yml",
];

test("service deploy workflows trigger without a paths: guard on push to main", () => {
  // GitHub's push-event paths filter silently skipped build-ui.yml on the
  // 2026-06-10 #524 merge, leaving the cluster on a 5-day-old UI image with no
  // failure anywhere (documented in the build-ui.yml trigger comment).  The same
  // silent-skip risk applies to every workflow that deploys to the umbrella
  // release: if N workflows should fire for a given push but GitHub's filter
  // quietly drops some of them, those services stay on old images and no CI
  // turns red — the exact failure described in the concurrent-deploys ticket.
  //
  // The fix (already applied to build-ui.yml): always trigger on main-push and
  // decide build-vs-skip inside the runner via git diff, never via GitHub's
  // on.push.paths filter.  See the changes job in build-ui.yml for the
  // canonical pattern.
  for (const wf of UMBRELLA_DEPLOY_WORKFLOWS) {
    const parsed = parse(readFileSync(wf, "utf-8"));

    assert.ok(
      !parsed["on"].push.paths,
      `${wf}: on.push must not have a paths: filter — ` +
        `it can silently suppress a deploy when N services change at once. ` +
        `Use the changes job pattern from build-ui.yml instead.`,
    );
  }
});
