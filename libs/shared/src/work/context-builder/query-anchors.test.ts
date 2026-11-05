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
      literals: [],
    });
  });

  it("reads issue 621 and PR #2154 as numbers", () => {
    expect(
      queryAnchors("Otto issue 621 reproduction, see PR #2154").numbers,
    ).toEqual([621, 2154]);
  });

  it("keeps FR-050 and a dotted FR id as they are written", () => {
    expect(
      queryAnchors("T010 actionExecutor FR-050 FR12.8b").requirements,
    ).toEqual(["FR-050", "FR12.8b"]);
  });

  it("takes a quoted log line and a backticked name as literals, leaving a backticked path to paths", () => {
    expect(
      queryAnchors(
        "lore-api logs 'source extraction switch: utopia answered 401' from `mirrorDocument` in `apps/lore-api/src/work/utopia/repo-mirror.ts`",
      ),
    ).toMatchObject({
      literals: [
        "source extraction switch: utopia answered 401",
        "mirrorDocument",
      ],
      paths: ["apps/lore-api/src/work/utopia/repo-mirror.ts"],
    });
  });

  it("finds nothing in a query that names nothing", () => {
    expect(queryAnchors("daily digest voice and intro")).toEqual({
      paths: [],
      requirements: [],
      numbers: [],
      literals: [],
    });
  });
});
