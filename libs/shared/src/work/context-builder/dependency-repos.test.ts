import { describe, expect, it } from "vitest";
import {
  orgDependencies,
  resolveDependency,
  type OrgDependency,
} from "./dependency-repos.js";

const ONBOARDED = ["re-cinq/HALEngine", "re-cinq/bowman-ui", "re-cinq/lore"];

describe("orgDependencies", () => {
  it("collects the @re-cinq packages of every manifest once, dev dependencies included", () => {
    expect(
      orgDependencies("@re-cinq", [
        JSON.stringify({
          dependencies: { "@re-cinq/hal-engine": "^0.12.0", react: "19" },
        }),
        JSON.stringify({
          dependencies: { "@re-cinq/hal-engine": "^0.12.0" },
          devDependencies: {
            "@re-cinq/eslint-plugin-re-lint": "1.10.0",
            "@re-cinq/planning-sync":
              "github:re-cinq/planning-station#sync-dist-v0.6.0",
          },
        }),
      ]),
    ).toEqual([
      { name: "@re-cinq/hal-engine", spec: "^0.12.0" },
      { name: "@re-cinq/eslint-plugin-re-lint", spec: "1.10.0" },
      {
        name: "@re-cinq/planning-sync",
        spec: "github:re-cinq/planning-station#sync-dist-v0.6.0",
      },
    ]);
  });

  it("skips a manifest that is not JSON", () => {
    expect(orgDependencies("@re-cinq", ["{not json"])).toEqual([]);
  });
});

describe("resolveDependency", () => {
  const dependency = (name: string, spec: string): OrgDependency => ({
    name,
    spec,
  });

  it("takes re-cinq/planning-station from a github: dependency", () => {
    expect(
      resolveDependency(
        dependency(
          "@re-cinq/planning-sync",
          "github:re-cinq/planning-station#sync-dist-v0.6.0",
        ),
        { registryRepository: null, onboarded: ONBOARDED },
      ),
    ).toBe("re-cinq/planning-station");
  });

  it("takes re-cinq/re-lint from the repository field the registry publishes", () => {
    expect(
      resolveDependency(
        dependency("@re-cinq/eslint-plugin-re-lint", "1.10.0"),
        {
          registryRepository: "git+https://github.com/re-cinq/re-lint.git",
          onboarded: ONBOARDED,
        },
      ),
    ).toBe("re-cinq/re-lint");
  });

  it("matches @re-cinq/hal-engine to the onboarded re-cinq/HALEngine when the registry names none", () => {
    expect(
      resolveDependency(dependency("@re-cinq/hal-engine", "^0.12.0"), {
        registryRepository: null,
        onboarded: ONBOARDED,
      }),
    ).toBe("re-cinq/HALEngine");
  });

  it("resolves an unknown package to nothing", () => {
    expect(
      resolveDependency(dependency("@re-cinq/mystery", "1.0.0"), {
        registryRepository: null,
        onboarded: ONBOARDED,
      }),
    ).toBeNull();
  });
});
