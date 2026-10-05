import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleDocuments } from "./sample.mjs";

const paths = (count) =>
  Array.from({ length: count }, (_, index) => `adrs/ADR-${index + 1}.md`);

test("returns all 7 documents, sorted, when the sample of 20 is larger than the list", () => {
  assert.deepEqual(
    sampleDocuments(paths(7), "2026-10-02", 20),
    paths(7).toSorted(),
  );
});

test("picks 20 distinct documents out of 50", () => {
  const picked = sampleDocuments(paths(50), "2026-10-02", 20);

  assert.equal(new Set(picked).size, 20);
  assert.ok(picked.every((path) => paths(50).includes(path)));
});

test("picks the same 20 documents again for the same date, whatever order the list arrives in", () => {
  assert.deepEqual(
    sampleDocuments(paths(50).toReversed(), "2026-10-02", 20),
    sampleDocuments(paths(50), "2026-10-02", 20),
  );
});

test("picks 20 other documents the next night", () => {
  const tonight = sampleDocuments(paths(50), "2026-10-02", 20);
  const tomorrow = sampleDocuments(paths(50), "2026-10-03", 20);

  assert.deepEqual(
    tomorrow.filter((path) => tonight.includes(path)),
    [],
  );
});

test("covers all 50 documents in 3 consecutive nights of 20", () => {
  const seen = new Set(
    ["2026-10-02", "2026-10-03", "2026-10-04"].flatMap((date) =>
      sampleDocuments(paths(50), date, 20),
    ),
  );

  assert.equal(seen.size, 50);
});

test("returns no documents for an empty list", () => {
  assert.deepEqual(sampleDocuments([], "2026-10-02", 20), []);
});

test("orders two documents by code unit, not by locale, so every runner picks the same window", () => {
  assert.deepEqual(
    sampleDocuments(["adrs/b.md", "adrs/B.md"], "2026-10-02", 20),
    ["adrs/B.md", "adrs/b.md"],
  );
});
