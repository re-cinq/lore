import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** Exit status of the classifier for one captured helm stderr. */
function isContention(stderr) {
  try {
    execFileSync("bash", ["scripts/ci/helm-lock-contention.sh"], {
      input: stderr,
    });

    return true;
  } catch {
    return false;
  }
}

test("classifies the in-progress lock as contention", () => {
  assert.equal(
    isContention(
      "Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress",
    ),
    true,
  );
});

test("classifies 'release: already exists' as contention", () => {
  // `helm upgrade --install` racing a concurrent deploy: it reads a release with
  // no deployed revision, decides to INSTALL, and finds the release there after
  // all. Misread as a hard failure this abandoned the event-router deploy while
  // floor and stations shipped, and both crash-looped against the stale router.
  assert.equal(
    isContention("Error: UPGRADE FAILED: release: already exists"),
    true,
  );
});

test("classifies the name-reuse variant as contention", () => {
  assert.equal(
    isContention("Error: cannot re-use a name that is still in use"),
    true,
  );
});

test("a genuine template error is NOT contention, so it fails loudly", () => {
  assert.equal(
    isContention(
      'Error: UPGRADE FAILED: template: lore-platform/templates/x.yaml:3:14: executing "x" at <.Values.nope>: nil pointer',
    ),
    false,
  );
});

test("a rollout timeout is NOT contention", () => {
  assert.equal(
    isContention("Error: UPGRADE FAILED: timed out waiting for the condition"),
    false,
  );
});
