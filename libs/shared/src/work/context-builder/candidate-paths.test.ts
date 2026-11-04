import { describe, expect, it } from "vitest";
import { candidatePaths, topLevelEntries } from "./candidate-paths.js";

const TREE = [
  "README.md",
  "apps/lore-api/src/transport/routes/ingest/embeddings.ts",
  "apps/lore-api/src/transport/routes/ingest/embeddings.test.ts",
  "apps/web-ui/src/app/page.tsx",
  "libs/shared/src/outbound/embeddings/embedding-service.ts",
  "specs/ingest-station/spec.md",
];

describe("candidatePaths", () => {
  it("ranks the paths sharing most words with the task first and drops paths sharing none", () => {
    expect(
      candidatePaths(TREE, {
        text: "batch embeddings route for the ingest station",
        named: [],
        limit: 10,
      }),
    ).toEqual([
      "apps/lore-api/src/transport/routes/ingest/embeddings.test.ts",
      "apps/lore-api/src/transport/routes/ingest/embeddings.ts",
      "specs/ingest-station/spec.md",
      "libs/shared/src/outbound/embeddings/embedding-service.ts",
    ]);
  });

  it("puts a path the query names first even when it shares no word", () => {
    expect(
      candidatePaths(TREE, {
        text: "embeddings",
        named: ["apps/web-ui/src/app/page.tsx"],
        limit: 2,
      }),
    ).toEqual([
      "apps/web-ui/src/app/page.tsx",
      "apps/lore-api/src/transport/routes/ingest/embeddings.test.ts",
    ]);
  });

  it("leaves out a named path the repository does not hold", () => {
    expect(
      candidatePaths(TREE, { text: "", named: ["gone/file.ts"], limit: 5 }),
    ).toEqual([]);
  });
});

describe("topLevelEntries", () => {
  it("lists apps, libs, README.md and specs once each, sorted", () => {
    expect(topLevelEntries(TREE)).toEqual([
      "README.md",
      "apps",
      "libs",
      "specs",
    ]);
  });
});
