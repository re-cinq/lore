import { describe, expect, it } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { InMemoryAgentDefinitions } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.fixture.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { registerBearerScope } from "../transport/http/bearer-scope.js";
import { orgAgentDefinitionUpdateRoute } from "../transport/routes/agent-definitions/org-update.js";
import {
  EXTENDED_REVIEWER,
  EXTENSION,
  fakeLeases,
  fakePack,
  SHIPPED_REVIEWER,
} from "../work/pack/pack-fakes.fixtures.js";
import { syncPack } from "../work/pack/sync-pack.js";

const ACME_PIPELINE = `line:
  id: acme-flow
  entry: work
  exit: done
  args:
    repo:
      kind: git
      subject: true
  nodes:
    - id: work
      station: work
      bind:
        target: repo
    - id: done
  edges:
    - from: work
      to: done
      on: success
    - from: work
      to: work
      on: failed
      iteration_max: 1
stations:
  work:
    description: Works the ticket.
    kind: agent
    agent_definition: acme-worker
    conversation: new
    outcomes:
      - success
      - failed
    result_required: true
    needs:
      - name: target
        kind: git
        path: target
    produces: []
`;

const ACME_WORKER =
  "---\nimage: acme/agent:2\ntimeout_minutes: 10\n---\nWork the ticket.\n";

async function appliedScratchPack() {
  const pack = fakePack();

  pack.files = [
    EXTENSION,
    { path: "acme-flow/assembly-line.yaml", text: ACME_PIPELINE },
    { path: "acme-flow/agents/acme-worker.md", text: ACME_WORKER },
  ];
  pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);
  const result = await syncPack(pack.deps(), fakeLeases(), "replica-a");

  return { pack, result };
}

function poolHolding(syncJson: string): Pool {
  return {
    query: async () => ({ rows: [{ value: syncJson }] }),
  } as unknown as Pool;
}

describe("a scratch pack applied to an install", () => {
  it("appends the extension to the shipped prompt of the reviewer", async () => {
    const { pack } = await appliedScratchPack();

    expect(pack.floorAgents.get("reviewer")).toEqual(EXTENDED_REVIEWER);
  });

  it("imports the new acme-flow pipeline and its new agent", async () => {
    const { pack } = await appliedScratchPack();

    expect({
      pipelines: [...pack.floorPipelines],
      worker: pack.floorAgents.get("acme-worker")?.image,
    }).toEqual({ pipelines: ["acme-flow"], worker: "acme/agent:2" });
  });

  it("records the head commit and what the pack supplies in pack.sync", async () => {
    const { pack } = await appliedScratchPack();

    expect(pack.sync).toMatchObject({
      repo: "acme/pack",
      commit: "c0ffee1",
      agent_count: 2,
      line_count: 1,
      extra_count: 1,
      refused_files: [],
      agents: expect.arrayContaining(["reviewer", "acme-worker"]),
      pipelines: ["acme-flow"],
      error: null,
    });
  });

  it("answers 409 pack_managed to a write of the pack's reviewer through the real route, leaving the floor's prompt", async () => {
    const { pack } = await appliedScratchPack();
    const floor = new InMemoryAgentDefinitions();
    const pool = poolHolding(JSON.stringify(pack.sync));
    const server = Hapi.server();

    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.LORE_PACK_REPO = "acme/scratch-pack";
    await floor.put("reviewer", {
      settings: {
        model: "claude-sonnet-4-6",
        prompt: "Review the diff.\n\nCheck our naming rules.",
        image: "agent:1",
        timeoutMinutes: 30,
      },
    });
    registerBearerScope(server, () => pool);
    server.route(
      orgAgentDefinitionUpdateRoute(
        () => pool,
        () => floor,
      ),
    );

    const res = await server.inject({
      method: "PUT",
      url: "/api/agent-definitions/reviewer",
      headers: AUTH,
      payload: { name: "reviewer", model: "claude-opus-4-8" },
    });

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload),
      model: (await floor.get("reviewer"))?.body.settings.model,
    }).toEqual({
      status: 409,
      body: { error: "pack_managed" },
      model: "claude-sonnet-4-6",
    });
  });
});
