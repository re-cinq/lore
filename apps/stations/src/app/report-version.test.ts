import { describe, it, expect } from "vitest";
import { InMemoryServiceVersions } from "@re-cinq/lore-shared/project/service-versions/service-versions-memory.js";
import { reportStationsVersion } from "./report-version.js";

describe("reportStationsVersion", () => {
  it("records stations' build with its floor-client, floor-station and libs/shared's floor-client", async () => {
    const versions = new InMemoryServiceVersions();

    await reportStationsVersion(versions, { LORE_BUILD_SHA: "abc1234" });

    expect(await versions.list()).toEqual([
      {
        service: "stations",
        build: "abc1234",
        packages: {
          "@re-cinq/floor-client": "0.1.11",
          "@re-cinq/floor-client (libs/shared)": "0.4.0",
          "@re-cinq/floor-station": "0.1.9",
        },
        startedAt: expect.any(Date),
      },
    ]);
  });
});
