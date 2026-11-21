import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

for (const image of ["apps/stations/Dockerfile", "apps/lore-api/Dockerfile"]) {
  test(`${image} copies scripts/lore-review-*.mjs, so a new review script reaches the image without an edit here`, async () => {
    const dockerfile = await readFile(new URL(image, root), "utf8");

    assert.deepEqual(
      dockerfile.split("\n").filter((line) => line.includes("lore-review-")),
      ["COPY scripts/lore-review-*.mjs ./scripts/"],
    );
  });
}

test("the build context leaves out the scripts' tests, which the glob would otherwise copy", async () => {
  const ignored = (await readFile(new URL(".dockerignore", root), "utf8")).split(
    "\n",
  );

  assert.ok(ignored.includes("scripts/*.test.mjs"));
});
