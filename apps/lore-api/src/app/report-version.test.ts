import { describe, it, expect } from "vitest";
import { InMemoryServiceVersions } from "@re-cinq/lore-shared/project/service-versions/service-versions-memory.js";
import { reportLoreApiVersion } from "./report-version.js";

describe("reportLoreApiVersion", () => {
  it("records lore-api's build with its floor-client and planning-sync versions", async () => {
    const versions = new InMemoryServiceVersions();

    await reportLoreApiVersion(versions, { LORE_BUILD_SHA: "abc1234" });

    expect(await versions.list()).toEqual([
      {
        service: "lore-api",
        build: "abc1234",
        packages: expect.objectContaining({
          "@re-cinq/floor-client": "0.4.0",
          "@re-cinq/planning-sync": expect.any(String),
        }),
        startedAt: expect.any(Date),
      },
    ]);
  });
});
