import { describe, expect, it } from "vitest";
import { encodeDigestRepos } from "./codec.js";
import { digestRunOfArgs } from "./digest-run.js";

const REPOS = encodeDigestRepos([
  {
    repo: "re-cinq/lore",
    since: "2026-10-01T07:00:00.000Z",
    sections: ["implemented", "roadmap"],
    group_by: "person",
  },
]);

const ARGS = {
  channel: "C123",
  week_key: "2026-W40",
  digest_date: "2026-10-01",
  digest_repos: REPOS,
};

describe("digestRunOfArgs", () => {
  it("reads channel C123, week 2026-W40 and date 2026-10-01 under the id it is given", () => {
    expect(digestRunOfArgs("visit-1", ARGS)).toMatchObject({
      id: "visit-1",
      channel: "C123",
      weekKey: "2026-W40",
      date: "2026-10-01",
      repos: [{ repo: "re-cinq/lore" }],
    });
  });

  it("names re-cinq/lore as the channel's repos, with no voice and no draft, when the args carry none", () => {
    expect(digestRunOfArgs("visit-1", ARGS)).toMatchObject({
      channelRepos: ["re-cinq/lore"],
      voice: "",
      draft: null,
    });
  });

  it("reads channel_repos re-cinq/lore,re-cinq/otto and the voice Michael Scott when given", () => {
    const run = digestRunOfArgs("visit-1", {
      ...ARGS,
      channel_repos: "re-cinq/lore,re-cinq/otto",
      voice: "Michael Scott",
    });

    expect(run).toMatchObject({
      channelRepos: ["re-cinq/lore", "re-cinq/otto"],
      voice: "Michael Scott",
    });
  });

  it("answers null when digest_repos is missing", () => {
    const { digest_repos: _dropped, ...incomplete } = ARGS;

    expect(digestRunOfArgs("visit-1", incomplete)).toBeNull();
  });
});
