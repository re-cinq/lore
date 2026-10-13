import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { encodeDigestRepos } from "@re-cinq/lore-shared/digest/codec.js";
import { digestCollectHandle, type DigestCollectDeps } from "./station.js";

const REPOS = encodeDigestRepos([
  {
    repo: "re-cinq/lore",
    since: "2026-09-30T07:00:00.000Z",
    sections: ["implemented"],
    group_by: "area",
  },
]);

const NEEDS = {
  channel: "C123",
  week_key: "2026-W40",
  digest_date: "2026-10-01",
  digest_repos: REPOS,
};

function scene(over: Partial<DigestCollectDeps> = {}) {
  const produced: Record<string, string> = {};
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("")),
    produce: (name, bytes) => {
      produced[name] = bytes.toString("utf8");

      return Promise.resolve();
    },
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const deps: DigestCollectDeps = {
    recentTexts: () => Promise.resolve([]),
    collect: () =>
      Promise.resolve({
        merged: [
          {
            repo: "re-cinq/lore",
            number: 7,
            title: "Teach the digest to count",
            branch: "feat/count",
            state: "closed",
            labels: [],
            url: "https://github.com/re-cinq/lore/pull/7",
          },
        ],
        closed: [],
        open: [],
      }),
    namesFor: () => Promise.resolve({}),
    ...over,
  };

  return { handle: digestCollectHandle(deps), tools, produced };
}

const brief = (needs: Record<string, string>) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000001",
  iteration: 1,
  needs,
});

describe("the digest-collect station", () => {
  it("produces digest_draft naming re-cinq/lore and its merged pull request 7", async () => {
    const { handle, tools, produced } = scene();
    const report = await handle(brief(NEEDS), tools);

    expect(report).toEqual({ outcome: "success" });
    expect(produced.digest_draft).toContain("re-cinq/lore");
    expect(produced.digest_draft).toContain(
      "https://github.com/re-cinq/lore/pull/7",
    );
  });

  it("still produces a draft, with the repo's section saying so, when GitHub cannot be read for re-cinq/lore", async () => {
    const { handle, tools, produced } = scene({
      collect: () => Promise.reject(new Error("GitHub API 502")),
    });
    const report = await handle(brief(NEEDS), tools);

    expect(report).toEqual({ outcome: "success" });
    expect(produced.digest_draft).toContain("GitHub API 502");
  });

  it("reports failed and produces nothing when the run carries no digest_repos", async () => {
    const { digest_repos: _dropped, ...incomplete } = NEEDS;
    const { handle, tools, produced } = scene();
    const report = await handle(brief(incomplete), tools);

    expect(report.outcome).toBe("failed");
    expect(produced).toEqual({});
  });

  it("reports failed with the reason when the channel's recent texts cannot be read", async () => {
    const { handle, tools } = scene({
      recentTexts: () => Promise.reject(new Error("db down")),
    });

    expect(await handle(brief(NEEDS), tools)).toEqual({
      outcome: "failed",
      error: "db down",
    });
  });
});
