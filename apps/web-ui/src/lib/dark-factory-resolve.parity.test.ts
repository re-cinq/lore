import { describe, it, expect } from "vitest";
import {
  resolveDarkFactorySettings as mirror,
  DEFAULT_AUTO_MERGE_PATHS as mirrorPaths,
  DEFAULT_EXECUTION_IMAGE as mirrorImage,
  type DarkFactorySettings,
} from "./dark-factory-resolve";
import {
  resolveDarkFactorySettings as canonical,
  DEFAULT_AUTO_MERGE_PATHS as canonicalPaths,
  DEFAULT_EXECUTION_IMAGE as canonicalImage,
} from "../../../../libs/shared/src/dark-factory-settings";

const PARTIALS: Array<DarkFactorySettings | null | undefined> = [
  null,
  undefined,
  {},
  ...[false, true].flatMap((enabled): DarkFactorySettings[] => [
    { enabled },
    { enabled, create_issue: "always" },
    { enabled, review: "never" },
    { enabled, notify: ["escalation"] },
    { enabled, auto_merge: { paths: ["docs/**"] } },
    { enabled, auto_merge: { min_trust: "full", require_green_ci: false } },
    { enabled, auto_merge: { require_bot_approval: false } },
    {
      enabled,
      create_issue: "never",
      review: "trust_based",
      notify: [],
      auto_merge: {
        paths: [],
        min_trust: "tests",
        require_green_ci: true,
        require_bot_approval: true,
      },
    },
  ]),
];

describe("dark-factory-resolve parity (web-ui mirror vs shared canonical)", () => {
  it.each(PARTIALS)("resolves %j identically", (partial) => {
    expect(mirror(partial)).toEqual(canonical(partial));
  });

  it("shares the default auto-merge paths and execution image", () => {
    expect(mirrorPaths).toEqual(canonicalPaths);
    expect(mirrorImage).toBe(canonicalImage);
  });
});
