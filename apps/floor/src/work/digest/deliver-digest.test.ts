import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryDigestPosts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-memory.js";
import { InMemorySlackPoster } from "@re-cinq/lore-shared/project/notify/slack-poster-memory.js";
import { encodeDigestRepos } from "@re-cinq/lore-shared/digest/codec.js";
import { APPENDIX_MARKER } from "@re-cinq/lore-shared/digest/render.js";
import { deliverDigestRun, receiveDigestUpload } from "./deliver-digest.js";

const DRAFT = `Intro placeholder.\n\n*re-cinq/lore*\n• item\n\nEnding placeholder.\n\n${APPENDIX_MARKER}\n- intro: Old`;
const REFINED = "Fresh intro.\n\n*re-cinq/lore*\n• item\n\nFresh ending!";

async function digestRun(
  assemblyRuns: InMemoryAssemblyRuns,
  extra: Record<string, unknown> = {},
) {
  const id = await assemblyRuns.start({
    blueprintName: "daily-digest",
    repo: "re-cinq/lore",
    args: {
      channel: "C1",
      week_key: "2026-W39",
      digest_date: "2026-09-25",
      digest_repos: encodeDigestRepos([
        {
          repo: "re-cinq/lore",
          since: "2026-09-24T07:00:00Z",
          sections: ["implemented"],
          group_by: "person",
        },
        {
          repo: "re-cinq/otto",
          since: "2026-09-24T07:00:00Z",
          sections: ["implemented"],
          group_by: "person",
        },
      ]),
      digest_draft: DRAFT,
      ...extra,
    },
  });

  await assemblyRuns.ensureStationRun({
    assemblyRunId: id,
    nodeId: "refine",
    iteration: 1,
    agentCrName: `${id.substring(0, 12)}-refine`,
  });

  return { id, agent: `${id.substring(0, 12)}-refine` };
}

function harness(slackRefuses?: string, acceptedBeforeRefusing = 0) {
  const assemblyRuns = new InMemoryAssemblyRuns();
  const posts = new InMemoryDigestPosts();
  const poster = new InMemorySlackPoster(slackRefuses, acceptedBeforeRefusing);
  const deps = {
    posts,
    poster,
    runOfAgent: async (agent: string) => {
      const visit = await assemblyRuns.findStationRunByAgentCrName(agent);

      return visit ? assemblyRuns.getById(visit.assemblyRunId) : null;
    },
  };

  return { assemblyRuns, posts, poster, deps };
}

describe("receiveDigestUpload", () => {
  it("posts the refined message on exit 0 as a thread-only reply under a new week parent", async () => {
    const { assemblyRuns, poster, deps } = harness();
    const { agent } = await digestRun(assemblyRuns);

    const delivery = await receiveDigestUpload(
      { agentCrName: agent, markdown: REFINED, exitCode: 0 },
      deps,
    );

    expect({ delivery, posts: poster.posts }).toEqual({
      delivery: { outcome: "posted", chunks: 1 },
      posts: [
        { channel: "C1", text: "Week 39 · re-cinq/lore, re-cinq/otto" },
        {
          channel: "C1",
          text: REFINED,
          threadTs: "1.000",
        },
      ],
    });
  });

  it("posts the draft without its appendix on a non-zero exit", async () => {
    const { assemblyRuns, poster, deps } = harness();
    const { agent } = await digestRun(assemblyRuns);

    await receiveDigestUpload(
      { agentCrName: agent, markdown: DRAFT, exitCode: 42 },
      deps,
    );

    expect(poster.posts[1]?.text).toBe(
      "Intro placeholder.\n\n*re-cinq/lore*\n• item\n\nEnding placeholder.",
    );
  });

  it("posts the draft when no markdown arrived", async () => {
    const { assemblyRuns, poster, deps } = harness();
    const { agent } = await digestRun(assemblyRuns);

    await receiveDigestUpload(
      { agentCrName: agent, markdown: "  ", exitCode: 0 },
      deps,
    );

    expect(poster.posts[1]?.text).toContain("Intro placeholder.");
  });

  it("replies in the stored thread on a later day of the same week", async () => {
    const { assemblyRuns, posts, poster, deps } = harness();
    const { agent } = await digestRun(assemblyRuns);

    await posts.claim("earlier", [
      { repo: "re-cinq/lore", channelId: "C1", weekKey: "2026-W39" },
    ]);
    await posts.finish("earlier", {
      threadTs: "9.000",
      intro: "Old",
      ending: "Bye",
    });
    await receiveDigestUpload(
      { agentCrName: agent, markdown: REFINED, exitCode: 0 },
      deps,
    );

    expect(poster.posts).toEqual([
      { channel: "C1", text: REFINED, threadTs: "9.000" },
    ]);
  });

  it("posts a long digest as several thread replies, none of them broadcast to the channel", async () => {
    const { assemblyRuns, poster, deps } = harness();
    const long = Array.from(
      { length: 400 },
      (_, i) => `• <https://gh/pr/${i}|Change number ${i}> (#${i})`,
    ).join("\n");
    const { agent } = await digestRun(assemblyRuns);

    const delivery = await receiveDigestUpload(
      { agentCrName: agent, markdown: long, exitCode: 0 },
      deps,
    );
    const replies = poster.posts.slice(1);

    expect({
      delivery,
      broadcasts: replies.filter((reply) => "replyBroadcast" in reply).length,
    }).toEqual({
      delivery: { outcome: "posted", chunks: replies.length },
      broadcasts: 0,
    });
    expect(replies.length).toBeGreaterThan(1);
  });

  it("records one finished row per repo with the intro and ending", async () => {
    const { assemblyRuns, posts, deps } = harness();
    const { id, agent } = await digestRun(assemblyRuns);

    await receiveDigestUpload(
      { agentCrName: agent, markdown: REFINED, exitCode: 0 },
      deps,
    );

    expect(
      posts.rows.map(({ runId, repo, threadTs, intro, ending }) => ({
        runId,
        repo,
        threadTs,
        intro,
        ending,
      })),
    ).toEqual([
      {
        runId: id,
        repo: "re-cinq/lore",
        threadTs: "1.000",
        intro: "Fresh intro.",
        ending: "Fresh ending!",
      },
      {
        runId: id,
        repo: "re-cinq/otto",
        threadTs: "1.000",
        intro: "Fresh intro.",
        ending: "Fresh ending!",
      },
    ]);
  });

  it("ignores a second delivery for the same run", async () => {
    const { assemblyRuns, poster, deps } = harness();
    const { id, agent } = await digestRun(assemblyRuns);

    await receiveDigestUpload(
      { agentCrName: agent, markdown: REFINED, exitCode: 0 },
      deps,
    );
    const run = await assemblyRuns.getById(id);
    const second = await deliverDigestRun(run!, null, deps);

    expect({ second, posted: poster.posts.length }).toEqual({
      second: { outcome: "already" },
      posted: 2,
    });
  });

  it("marks the run failed and rethrows slack's error when nothing reached the channel", async () => {
    const { assemblyRuns, posts, deps } = harness("not_in_channel");
    const { agent } = await digestRun(assemblyRuns);

    await expect(
      receiveDigestUpload(
        { agentCrName: agent, markdown: REFINED, exitCode: 0 },
        deps,
      ),
    ).rejects.toThrow(new Error("slack chat.postMessage: not_in_channel"));
    expect(posts.rows.map((r) => r.status)).toEqual(["failed", "failed"]);
  });

  it("replies in the thread a failed run opened instead of opening a second one", async () => {
    const { assemblyRuns, posts, poster, deps } = harness();
    const failing = harness("ratelimited", 1);
    const first = await digestRun(failing.assemblyRuns);

    await receiveDigestUpload(
      { agentCrName: first.agent, markdown: REFINED, exitCode: 0 },
      failing.deps,
    ).catch(() => {});
    posts.rows.push(...failing.posts.rows);
    const second = await digestRun(assemblyRuns);

    await receiveDigestUpload(
      { agentCrName: second.agent, markdown: REFINED, exitCode: 0 },
      deps,
    );

    expect(poster.posts).toEqual([
      { channel: "C1", text: REFINED, threadTs: "1.000" },
    ]);
  });

  it("counts a digest as posted once its first part is in the channel, so a retry never repeats it", async () => {
    const { assemblyRuns, posts, deps } = harness("ratelimited", 2);
    const long = Array.from(
      { length: 400 },
      (_, i) => `• <https://gh/pr/${i}|Change number ${i}> (#${i})`,
    ).join("\n");
    const { agent } = await digestRun(assemblyRuns);

    await expect(
      receiveDigestUpload(
        { agentCrName: agent, markdown: long, exitCode: 0 },
        deps,
      ),
    ).rejects.toThrow(new Error("slack chat.postMessage: ratelimited"));
    expect(await posts.lastPostedAt("re-cinq/lore")).not.toBe(null);
  });

  it("names every repo on the channel in the week's thread parent", async () => {
    const { assemblyRuns, poster, deps } = harness();
    const { agent } = await digestRun(assemblyRuns, {
      channel_repos: "re-cinq/lore,re-cinq/otto,re-cinq/planning-station",
    });

    await receiveDigestUpload(
      { agentCrName: agent, markdown: REFINED, exitCode: 0 },
      deps,
    );

    expect(poster.posts[0]?.text).toBe(
      "Week 39 · re-cinq/lore, re-cinq/otto, re-cinq/planning-station",
    );
  });

  it("skips an upload from an agent no digest run knows", async () => {
    const { deps } = harness();

    expect(
      await receiveDigestUpload(
        { agentCrName: "nobody-refine", markdown: REFINED, exitCode: 0 },
        deps,
      ),
    ).toEqual({
      outcome: "skipped",
      error: "no digest run knows this agent",
    });
  });

  it("skips a closed run whose pod never downloaded a draft", async () => {
    const { assemblyRuns, deps } = harness();
    const { id } = await digestRun(assemblyRuns, { digest_draft: undefined });
    const run = await assemblyRuns.getById(id);

    expect(await deliverDigestRun(run!, null, deps)).toEqual({
      outcome: "skipped",
      error: "the run has neither a message nor a draft",
    });
  });
});
