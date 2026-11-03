import { describe, expect, it } from "vitest";
import { queryAnchors } from "./query-anchors.js";

describe("queryAnchors", () => {
  it("finds the spec path, FR id and file path a review query names", () => {
    expect(
      queryAnchors(
        "Drop POST /api/embed. Touches specs/ingest-station/spec.md (FR4) and apps/lore-api/src/transport/routes/ingest/embed.ts",
      ),
    ).toEqual({
      paths: [
        "apps/lore-api/src/transport/routes/ingest/embed.ts",
        "specs/ingest-station/spec.md",
      ],
      requirements: ["FR4"],
      numbers: [],
    });
  });

  it("reads issue 621 and PR #2154 as numbers", () => {
    expect(
      queryAnchors("Otto issue 621 reproduction, see PR #2154").numbers,
    ).toEqual([621, 2154]);
  });

  it("keeps FR-050 and FR12.8b as they are written", () => {
    expect(
      queryAnchors("T010 actionExecutor FR-050 FR12.8b").requirements,
    ).toEqual(["FR-050", "FR12.8b"]);
  });

  it("finds nothing in a query that names nothing", () => {
    expect(queryAnchors("daily digest voice and intro")).toEqual({
      paths: [],
      requirements: [],
      numbers: [],
    });
  });
});
