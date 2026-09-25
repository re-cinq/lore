import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryDigestPosts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-memory.js";
import { InMemorySlackPoster } from "@re-cinq/lore-shared/project/notify/slack-poster-memory.js";
import { encodeDigestRepos } from "@re-cinq/lore-shared/digest/codec.js";
import { buildServer } from "../server.js";

const runs = new InMemoryAssemblyRuns();
const posts = new InMemoryDigestPosts();
const poster = new InMemorySlackPoster();

vi.mock("../../../outbound/queues.js", () => ({
  clusterAgent: () => ({}),
  usage: () => ({ logLlmCall: vi.fn() }),
  agentRunEvents: () => ({ insertBatch: vi.fn() }),
  auditLog: () => ({ write: vi.fn() }),
  pipeline: () => ({ assemblyRuns: runs, digestPosts: posts }),
}));

vi.mock("../../../work/digest/deps.js", () => ({
  draftDeps: () => ({
    runById: (id: string) => runs.getById(id),
    mergeArgs: (id: string, patch: Record<string, unknown>) =>
      runs.mergeArgs(id, patch),
    recentTexts: (channel: string, limit: number) =>
      posts.recentTexts(channel, limit),
    collect: async () => ({
      merged: [
        {
          repo: "re-cinq/lore",
          number: 1,
          title: "Digest core",
          branch: "b",
          state: "merged",
          labels: [],
          url: "https://gh/pr/1",
          author: "alice",
        },
      ],
      closed: [],
      open: [],
    }),
    namesFor: async () => ({}),
  }),
  uploadDeps: () => ({
    posts,
    poster,
    runOfAgent: async (agent: string) => {
      const visit = await runs.findStationRunByAgentCrName(agent);

      return visit ? runs.getById(visit.assemblyRunId) : null;
    },
  }),
}));

const ORIG = process.env.LORE_AGENT_INTERNAL_TOKEN;
const auth = { authorization: "Bearer test-internal" };
const server = () => buildServer({ getJobStatus: () => ({}) });

async function digestRun(): Promise<{ id: string; agent: string }> {
  const id = await runs.start({
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
          sections: ["implemented", "summary"],
          group_by: "person",
        },
      ]),
    },
  });
  const agent = `${id.substring(0, 12)}-refine`;

  await runs.ensureStationRun({
    assemblyRunId: id,
    nodeId: "refine",
    iteration: 1,
    agentCrName: agent,
  });

  return { id, agent };
}

beforeEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = "test-internal";
  poster.posts.length = 0;
  posts.rows.length = 0;
});

afterEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG;
});

describe("GET /api/agent-files/runs/{runId}/digest-draft", () => {
  it("serves the collected draft as markdown and keeps it on the run", async () => {
    const { id } = await digestRun();

    const res = await server().inject({
      method: "GET",
      url: `/api/agent-files/runs/${id}/digest-draft`,
      headers: auth,
    });

    expect({
      status: res.statusCode,
      type: res.headers["content-type"],
      stored: (await runs.getById(id))?.args.digest_draft,
    }).toEqual({
      status: 200,
      type: "text/markdown; charset=utf-8",
      stored: res.payload,
    });
    expect(res.payload).toContain("<https://gh/pr/1|Digest core> (#1)");
  });

  it("answers 404 for an input source no run has", async () => {
    const { id } = await digestRun();

    const res = await server().inject({
      method: "GET",
      url: `/api/agent-files/runs/${id}/something-else`,
      headers: auth,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/agent-files/{agent}/digest.message", () => {
  it("posts the uploaded message into the week's thread and answers posted", async () => {
    const { agent } = await digestRun();

    const res = await server().inject({
      method: "POST",
      url: `/api/agent-files/${agent}/digest.message`,
      headers: {
        ...auth,
        "content-type": "application/octet-stream",
        "x-agent-exit-code": "0",
      },
      payload: Buffer.from(
        "Hello team.\n\n*re-cinq/lore*\n• <https://gh/pr/1|Digest core> (#1)\n\nOnwards!",
      ),
    });

    expect({
      status: res.statusCode,
      body: res.result,
      texts: poster.posts.map((p) => p.text),
    }).toEqual({
      status: 200,
      body: { status: "posted" },
      texts: [
        "Week 39 · re-cinq/lore",
        "Hello team.\n\n*re-cinq/lore*\n• <https://gh/pr/1|Digest core> (#1)\n\nOnwards!",
      ],
    });
  });

  it("answers 404 for an upload from an agent no digest run knows", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/agent-files/unknown-refine/digest.message",
      headers: { ...auth, "content-type": "application/octet-stream" },
      payload: Buffer.from("x"),
    });

    expect(res.statusCode).toBe(404);
  });
});
