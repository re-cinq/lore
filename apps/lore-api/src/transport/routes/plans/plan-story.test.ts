import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import type {
  PlanStories,
  SavedStory,
} from "../../../work/plans/plan-stories.js";
import { planStoryRoutes } from "./plan-story.js";

function serve(given: { saved?: SavedStory; runStory?: number | null } = {}) {
  const writes: Array<Parameters<PlanStories["save"]>[0]> = [];
  const server = Hapi.server();

  server.route(
    planStoryRoutes({
      plan: async (planId) =>
        planId === "p1" ? { id: "p1", repo: "re-cinq/lore" } : null,
      stories: {
        saved: async () => given.saved,
        save: async (story) => {
          writes.push(story);
        },
      },
      runStory: async () => given.runStory ?? null,
    }),
  );

  return { server, writes };
}

const get = (server: Hapi.Server, id = "p1") =>
  server.inject({ method: "GET", url: `/api/plans/${id}/story` });

const post = (server: Hapi.Server, payload: object) =>
  server.inject({ method: "POST", url: "/api/plans/p1/story", payload });

describe("GET /api/plans/{id}/story", () => {
  it("answers saved story 12 with its issue URL on the plan's repository, though the run names 7", async () => {
    const { server } = serve({ saved: { issueNumber: 12 }, runStory: 7 });

    const res = await get(server);

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: {
        issueNumber: 12,
        issueUrl: "https://github.com/re-cinq/lore/issues/12",
      },
    });
  });

  it("answers the run's story 7 when nothing was saved on the plan", async () => {
    const { server } = serve({ runStory: 7 });

    const res = await get(server);

    expect(res.result).toEqual({
      issueNumber: 7,
      issueUrl: "https://github.com/re-cinq/lore/issues/7",
    });
  });

  it("answers no story when the saved story was removed though the run names 7", async () => {
    const { server } = serve({ saved: { issueNumber: null }, runStory: 7 });

    const res = await get(server);

    expect(res.result).toEqual({ issueNumber: null, issueUrl: null });
  });

  it("answers 404 when reading the story of a plan that does not exist", async () => {
    const { server } = serve();

    const res = await get(server, "nope");

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/plans/{id}/story", () => {
  it("saves story 12 set by ana on a plan that has none and answers it with its URL", async () => {
    const { server, writes } = serve();

    const res = await post(server, { issueNumber: 12, setBy: "ana" });

    expect({ status: res.statusCode, body: res.result, writes }).toEqual({
      status: 200,
      body: {
        issueNumber: 12,
        issueUrl: "https://github.com/re-cinq/lore/issues/12",
      },
      writes: [{ planId: "p1", issueNumber: 12, setBy: "ana" }],
    });
  });

  it("saves nothing when the plan's run already names story 12", async () => {
    const { server, writes } = serve({ runStory: 12 });

    const res = await post(server, { issueNumber: 12, setBy: "spec-tickets" });

    expect({ status: res.statusCode, writes }).toEqual({
      status: 200,
      writes: [],
    });
  });

  it("saves nothing when story 12 is already saved", async () => {
    const { server, writes } = serve({ saved: { issueNumber: 12 } });

    await post(server, { issueNumber: 12, setBy: "ana" });

    expect(writes).toEqual([]);
  });

  it("saves the removal of story 7 that only the run names, so it stays removed", async () => {
    const { server, writes } = serve({ runStory: 7 });

    const res = await post(server, { issueNumber: null, setBy: "ana" });

    expect({ body: res.result, writes }).toEqual({
      body: { issueNumber: null, issueUrl: null },
      writes: [{ planId: "p1", issueNumber: null, setBy: "ana" }],
    });
  });

  it("saves nothing when removing a story from a plan that has none", async () => {
    const { server, writes } = serve();

    await post(server, { issueNumber: null, setBy: "ana" });

    expect(writes).toEqual([]);
  });

  it("answers 400 and saves nothing for issue 0", async () => {
    const { server, writes } = serve();

    const res = await post(server, { issueNumber: 0, setBy: "ana" });

    expect({ status: res.statusCode, writes }).toEqual({
      status: 400,
      writes: [],
    });
  });

  it("answers 404 when saving a story on a plan that does not exist", async () => {
    const { server } = serve();

    const res = await server.inject({
      method: "POST",
      url: "/api/plans/nope/story",
      payload: { issueNumber: 12, setBy: "ana" },
    });

    expect(res.statusCode).toBe(404);
  });
});
