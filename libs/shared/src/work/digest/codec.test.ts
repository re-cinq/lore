import { describe, it, expect } from "vitest";
import { decodeDigestRepos, encodeDigestRepos } from "./codec.js";
import { DIGEST_DEFAULTS } from "../../domain/digest-settings.js";

const repos = [
  {
    repo: "re-cinq/lore",
    since: "2026-09-24T07:00:00Z",
    sections: DIGEST_DEFAULTS.sections,
    group_by: "person" as const,
  },
];

describe("digest repos codec", () => {
  it("round-trips digest_repos through the line args", () => {
    expect(decodeDigestRepos(encodeDigestRepos(repos))).toEqual(repos);
  });

  it("rejects malformed digest_repos naming the field", () => {
    expect(() => decodeDigestRepos('[{"repo":"x"}]')).toThrow(/digest_repos/);
  });
});
