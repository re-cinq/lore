import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

for (const image of ["apps/stations/Dockerfile", "apps/lore-api/Dockerfile"]) {
  test(`${image} copies every review script, since the collector fails at its first import of one the image lacks`, async () => {
    const scripts = (await readdir(new URL("scripts/", root)))
      .filter((name) => /^lore-review-.*\.mjs$/.test(name))
      .filter((name) => !name.endsWith(".test.mjs"))
      .map((name) => `scripts/${name}`);
    const dockerfile = await readFile(new URL(image, root), "utf8");
    const copied = dockerfile
      .split("\n")
      .filter((line) => line.startsWith("COPY scripts/lore-review-"))
      .flatMap((line) => line.split(/\s+/));

    assert.deepEqual(
      scripts.filter((script) => !copied.includes(script)),
      [],
    );
  });
}
