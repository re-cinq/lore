import { describe, expect, it } from "vitest";
import { relatedRepos, type RelatedRepoReaders } from "./related-repos.js";

const OTTO_MANIFESTS = [
  JSON.stringify({ workspaces: ["apps/*"] }),
  JSON.stringify({
    dependencies: {
      "@re-cinq/hal-engine": "^0.12.0",
      "@re-cinq/bowman-ui": "^2.1.0",
    },
  }),
];

function readers(overrides: Partial<RelatedRepoReaders> = {}) {
  const asked: string[] = [];
  const base: RelatedRepoReaders = {
    manifests: async () => OTTO_MANIFESTS,
    registryRepository: async (name) => {
      asked.push(name);

      return null;
    },
    onboarded: async () => [
      "re-cinq/HALEngine",
      "re-cinq/bowman-ui",
      "re-cinq/Otto",
    ],
    linked: [],
  };

  return { asked, readers: { ...base, ...overrides } };
}

describe("relatedRepos", () => {
  it("reads re-cinq/HALEngine and re-cinq/bowman-ui beside re-cinq/Otto, which depends on their packages", async () => {
    const { asked, readers: otto } = readers();

    expect(await relatedRepos("re-cinq/Otto", otto)).toEqual([
      "re-cinq/HALEngine",
      "re-cinq/bowman-ui",
    ]);
    expect(asked).toEqual(["@re-cinq/hal-engine", "@re-cinq/bowman-ui"]);
  });

  it("takes re-cinq/re-lint from the registry's repository field for @re-cinq/eslint-plugin-re-lint", async () => {
    const { readers: lore } = readers({
      manifests: async () => [
        JSON.stringify({
          devDependencies: { "@re-cinq/eslint-plugin-re-lint": "1.10.0" },
        }),
      ],
      registryRepository: async () =>
        "git+https://github.com/re-cinq/re-lint.git",
    });

    expect(await relatedRepos("re-cinq/lore", lore)).toEqual([
      "re-cinq/re-lint",
    ]);
  });

  it("adds the linked re-cinq/recinq-tms and never re-cinq/Otto itself", async () => {
    const { readers: otto } = readers({
      linked: ["re-cinq/recinq-tms", "re-cinq/Otto", "re-cinq/HALEngine"],
    });

    expect(await relatedRepos("re-cinq/Otto", otto)).toEqual([
      "re-cinq/HALEngine",
      "re-cinq/bowman-ui",
      "re-cinq/recinq-tms",
    ]);
  });
});
