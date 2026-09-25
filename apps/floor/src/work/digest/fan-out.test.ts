import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryDigestPosts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-memory.js";
import { digestSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import { decodeDigestRepos } from "@re-cinq/lore-shared/digest/codec.js";
import { createDailyDigestTickHandler } from "./fan-out.js";

const FRIDAY_0905_BERLIN = new Date("2026-09-25T07:05:00Z");

const repoRow = (full_name: string, channel: string | undefined, digest: Record<string, unknown> = { enabled: true }) => ({
  full_name,
  settings: { slack_channel_id: channel, digest },
});

function harness(rows: ReturnType<typeof repoRow>[], now = FRIDAY_0905_BERLIN) {
  const assemblyRuns = new InMemoryAssemblyRuns();
  const posts = new InMemoryDigestPosts(() => now);
  const started: string[] = [];
  const failed: Array<{ runId: string; reason: string }> = [];
  const handler = createDailyDigestTickHandler({
    repoSettings: async () => rows,
    posts,
    assemblyRuns,
    jobRuns: {
      start: async (jobName) => {
        started.push(jobName);

        return `jr-${started.length}`;
      },
      fail: async (runId, reason) => {
        failed.push({ runId, reason });
      },
    },
    defaultBranch: async () => "main",
    now: () => now,
  });

  return { assemblyRuns, posts, started, failed, handler };
}

describe("createDailyDigestTickHandler", () => {
  it("skips repos whose digest is disabled or that have no channel", async () => {
    const { assemblyRuns, handler } = harness([
      repoRow("re-cinq/lore", "C1", { enabled: false }),
      repoRow("re-cinq/otto", undefined),
    ]);

    await handler({});

    expect(assemblyRuns.rows).toEqual([]);
  });

  it("starts one run per channel when two due repos share it, hosted by the first repo by name", async () => {
    const { assemblyRuns, started, handler } = harness([
      repoRow("re-cinq/otto", "C1"),
      repoRow("re-cinq/lore", "C1"),
      repoRow("re-cinq/other", "C2"),
    ]);

    await handler({});

    expect(assemblyRuns.rows.map((r) => ({ repo: r.repo, branch: r.branch, subjectKey: r.subjectKey }))).toEqual([
      { repo: "re-cinq/lore", branch: "digest/C1", subjectKey: digestSubject("C1", "2026-09-25") },
      { repo: "re-cinq/other", branch: "digest/C2", subjectKey: digestSubject("C2", "2026-09-25") },
    ]);
    expect(started).toEqual(["daily_digest:C1", "daily_digest:C2"]);
  });

  it("carries every repo's window, sections and grouping in the run's args, with ref set to the host repo's default branch", async () => {
    const { assemblyRuns, handler } = harness([
      repoRow("re-cinq/lore", "C1", { enabled: true, sections: ["roadmap"], group_by: "area" }),
    ]);

    await handler({});
    const { args } = assemblyRuns.rows[0];

    expect({ ...args, digest_repos: decodeDigestRepos(String(args.digest_repos)) }).toEqual({
      job_run_id: "jr-1",
      channel: "C1",
      week_key: "2026-W39",
      digest_date: "2026-09-25",
      ref: "main",
      description: "Daily digest for C1: re-cinq/lore, 2026-09-25",
      digest_repos: [
        { repo: "re-cinq/lore", since: "2026-09-24T07:05:00.000Z", sections: ["roadmap"], group_by: "area" },
      ],
    });
  });

  it("opens the window at the repo's last finished post", async () => {
    const { assemblyRuns, posts, handler } = harness([repoRow("re-cinq/lore", "C1")]);
    const yesterday = new InMemoryDigestPosts(() => new Date("2026-09-24T07:10:00Z"));

    await yesterday.claim("old", [{ repo: "re-cinq/lore", channelId: "C1", weekKey: "2026-W39" }]);
    await yesterday.finish("old", { threadTs: "1.1", intro: "", ending: "" });
    posts.rows.push(...yesterday.rows);
    await handler({});

    expect(decodeDigestRepos(String(assemblyRuns.rows[0].args.digest_repos))[0].since).toBe(
      "2026-09-24T07:10:00.000Z",
    );
  });

  it("starts nothing before the repo's time of day", async () => {
    const { assemblyRuns, handler } = harness([repoRow("re-cinq/lore", "C1")], new Date("2026-09-25T06:30:00Z"));

    await handler({});

    expect(assemblyRuns.rows).toEqual([]);
  });

  it("skips a channel whose run for today is in flight", async () => {
    const { assemblyRuns, started, handler } = harness([repoRow("re-cinq/lore", "C1")]);

    await assemblyRuns.start({
      blueprintName: "daily-digest",
      repo: "re-cinq/lore",
      subjectKey: digestSubject("C1", "2026-09-25"),
    });
    await handler({});

    expect({ runs: assemblyRuns.rows.length, started }).toEqual({ runs: 1, started: [] });
  });

  it("gives up on a channel after three runs in one day", async () => {
    const { assemblyRuns, started, handler } = harness([repoRow("re-cinq/lore", "C1")]);
    const subjectKey = digestSubject("C1", "2026-09-25");

    for (let attempt = 0; attempt < 3; attempt++) {
      const id = await assemblyRuns.start({ blueprintName: "daily-digest", repo: "re-cinq/lore", subjectKey });

      await assemblyRuns.finish(id, "error", "pod died");
    }
    await handler({});

    expect({ runs: assemblyRuns.rows.length, started }).toEqual({ runs: 3, started: [] });
  });

  it("narrows to params.repo and force skips the due check", async () => {
    const { assemblyRuns, handler } = harness(
      [repoRow("re-cinq/lore", "C1"), repoRow("re-cinq/otto", "C2")],
      new Date("2026-09-25T06:30:00Z"),
    );

    await handler({ repo: "re-cinq/otto", force: true });

    expect(assemblyRuns.rows.map((r) => r.repo)).toEqual(["re-cinq/otto"]);
  });

  it("fails the orphaned job_run when the start throws", async () => {
    const { assemblyRuns, failed, handler } = harness([repoRow("re-cinq/lore", "C1")]);

    assemblyRuns.start = async () => {
      throw new Error("db down");
    };

    await expect(handler({})).rejects.toThrow(new Error("db down"));
    expect(failed).toEqual([{ runId: "jr-1", reason: "assembly_line.start failed: db down" }]);
  });
});
