import { test } from "node:test";
import assert from "node:assert/strict";

import { behindLine } from "./lore-version-check.mjs";

const BUILT = "0ld0000aaaabbbbccccddddeeeeffff0000111122";

test("behindLine names the built and latest builds when the adapter is behind", () => {
  assert.equal(
    behindLine(BUILT, "abc1234", "behind"),
    "[lore] Your Lore MCP is behind the deployed version (0ld0000 → abc1234). Ask Claude to run lore_update.",
  );
});

test("behindLine treats an unknown relation as behind", () => {
  assert.match(behindLine(BUILT, "abc1234", "unknown"), /behind the deployed/);
});

test("behindLine prints nothing for an adapter built from the latest short sha", () => {
  assert.equal(behindLine(BUILT, "0ld0000", "unknown"), "");
});

test("behindLine prints nothing for an adapter ahead of the deployed build", () => {
  assert.equal(behindLine(BUILT, "abc1234", "ahead"), "");
});

test("behindLine prints nothing without a built or latest build", () => {
  assert.equal(behindLine("", "abc1234", "unknown"), "");
  assert.equal(behindLine(BUILT, null, "unknown"), "");
});
