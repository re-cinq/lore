import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryDigestPosts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-memory.js";
import { encodeDigestRepos } from "@re-cinq/lore-shared/digest/codec.js";
import { APPENDIX_MARKER, INTRO_MARKER } from "@re-cinq/lore-shared/digest/render.js";
import { digestDraftOf, type RepoCollector } from "./serve-draft.js";

const runs = () => new InMemoryAssemblyRuns();
const digestArgs = (repos: string[]) => ({
  channel: "C1",
  week_key: "2026-W39",
  digest_date: "2026-09-25",
  digest_repos: encodeDigestRepos(
    repos.map((repo) => ({
      repo,
      since: "2026-09-24T07:00:00Z",
      sections: ["implemented", "roadmap", "summary", "morale"],
      group_by: "person",
    })),
  ),
});

const collectOne: RepoCollector = async (entry) => ({
  merged: [
    {
      repo: entry.repo,
      number: 1,
      title: `Merged in ${entry.repo}`,
      branch: "b",
      state: "merged",
      labels: [],
      url: `https://gh/${entry.repo}/pr/1`,
      author: "alice",
    },
  ],
  closed: [],
  open: [],
});

function deps(assemblyRuns: InMemoryAssemblyRuns, collect: RepoCollector) {
  const posts = new InMemoryDigestPosts();

  return {
    runById: (id: string) => assemblyRuns.getById(id),
    mergeArgs: (id: string, patch: Record<string, unknown>) => assemblyRuns.mergeArgs(id, patch),
    recentTexts: (channel: string, limit: number) => posts.recentTexts(channel, limit),
    collect,
  };
}

describe("digestDraftOf", () => {
  it("collects every repo into one draft and stores it on the run on the first download", async () => {
    const assemblyRuns = runs();
    const id = await assemblyRuns.start({
      blueprintName: "daily-digest",
      repo: "re-cinq/lore",
      args: digestArgs(["re-cinq/lore", "re-cinq/otto"]),
    });

    const draft = await digestDraftOf(id, deps(assemblyRuns, collectOne));

    expect(draft).toContain("Merged in re-cinq/lore");
    expect(draft).toContain("Merged in re-cinq/otto");
    expect((await assemblyRuns.getById(id))?.args.digest_draft).toBe(draft);
  });

  it("serves the stored draft unchanged on a retry without reading GitHub again", async () => {
    const assemblyRuns = runs();
    const id = await assemblyRuns.start({
      blueprintName: "daily-digest",
      repo: "re-cinq/lore",
      args: { ...digestArgs(["re-cinq/lore"]), digest_draft: "the draft" },
    });
    const refusing: RepoCollector = async () => {
      throw new Error("must not read GitHub twice");
    };

    expect(await digestDraftOf(id, deps(assemblyRuns, refusing))).toBe("the draft");
  });

  it("renders a failed repo read as its own section", async () => {
    const assemblyRuns = runs();
    const id = await assemblyRuns.start({
      blueprintName: "daily-digest",
      repo: "re-cinq/lore",
      args: digestArgs(["re-cinq/lore"]),
    });
    const failing: RepoCollector = async () => {
      throw new Error("GitHub 502");
    };

    expect(await digestDraftOf(id, deps(assemblyRuns, failing))).toContain(
      "_could not read re-cinq/lore: GitHub 502_",
    );
  });

  it("returns null for a run that is not a digest run", async () => {
    const assemblyRuns = runs();
    const id = await assemblyRuns.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      args: { pr_number: 1 },
    });

    expect(await digestDraftOf(id, deps(assemblyRuns, collectOne))).toBe(null);
  });

  it("puts the intro marker and the appendix around the sections", async () => {
    const assemblyRuns = runs();
    const id = await assemblyRuns.start({
      blueprintName: "daily-digest",
      repo: "re-cinq/lore",
      args: digestArgs(["re-cinq/lore"]),
    });

    const draft = (await digestDraftOf(id, deps(assemblyRuns, collectOne))) ?? "";

    expect(draft.indexOf(INTRO_MARKER)).toBeLessThan(draft.indexOf("*re-cinq/lore*"));
    expect(draft.indexOf("*re-cinq/lore*")).toBeLessThan(draft.indexOf(APPENDIX_MARKER));
  });
});
