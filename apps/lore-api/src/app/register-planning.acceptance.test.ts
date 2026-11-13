import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { registerPlanning } from "./register-planning.js";
import { registerBearerScope } from "../transport/http/bearer-scope.js";
import { plansRoutes } from "../transport/routes/plans/plans.js";
import { AUTH } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/outbound/db.js";
import { planVerbsFor } from "../transport/routes/plans/plan-verbs-for.js";
import * as http from "node:http";
import * as Y from "yjs";

const PLAN_ID = "0f3c2a2e-6b1a-4c5e-9d2f-1a2b3c4d5e6f";

const emptyDocState = Y.encodeStateAsUpdate(new Y.Doc());

const PLAN_ROW = {
  id: PLAN_ID,
  repo: "re-cinq/lore",
  title: "Test",
  type: "feature",
  template_version: 1,
  templateVersion: 1,
  status: "draft",
  approval: null,
  current_version: 1,
  currentVersion: 1,
  created_by: "ana",
  createdBy: "ana",
  created_at: new Date("2026-10-01T10:00:00Z"),
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updated_at: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
  document: emptyDocState,
  state: emptyDocState,
};

describe("registerPlanning acceptance", () => {
  const originalEnv = { ...process.env };
  let floorServer: http.Server;
  let floorUrl = "";

  beforeEach(async () => {
    floorServer = http.createServer((req, res) => {
      if (req.url?.includes("/events")) {
        res.writeHead(200);
        res.end(JSON.stringify({ outcome: "success" }));

        return;
      }

      if (req.method === "GET") {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            items: [
              {
                id: "run-open",
                status: "open",
                startedAt: "2026-10-01T10:00:00.000Z",
                startItems: { plan_id: { kind: "value", ref: PLAN_ID } },
              },
            ],
            visits: [{ id: "v1", nodeId: "author", report: null }],
          }),
        );

        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      floorServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = floorServer.address() as import("node:net").AddressInfo;

    floorUrl = `http://127.0.0.1:${addr.port}`;

    process.env.LORE_INGEST_TOKEN = "test-token";
    process.env.FLOOR_API_URL = floorUrl;
    process.env.FLOOR_SERVICE_TOKEN = "test-token";
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await new Promise<void>((resolve) => floorServer.close(() => resolve()));
  });

  it("A Refine through production dependency construction records its ask on the server pool and starts analyze", async () => {
    let recorded = false;
    const server = Hapi.server();
    const query = async (text: string, _params: unknown[]) => {
      if (text.includes("assembly_runs")) {
        return { rows: [] };
      }

      if (text.includes("plan_refine_asks")) {
        recorded = true;

        return { rows: [] };
      }

      return { rows: [PLAN_ROW] };
    };
    const pool = { query } as unknown as Pool;

    setPool(pool);

    registerBearerScope(server, () => pool);
    const registered = registerPlanning(server, () => pool);

    server.route(plansRoutes(() => pool, registered.plans));

    server.events.on("request", (_request, event, tags) => {
      if (tags.error) {
        console.error("REQ_ERR", event.error);
      }
    });

    const res = await server.inject({
      method: "POST",
      url: `/api/repos/re-cinq/lore/plans/${PLAN_ID}/refine`,
      headers: AUTH,
      payload: {
        actor: "ana",
        slot: "intent",
        title: "Intent",
        baseHash: "3f9a",
        inputs: {},
        uses: {},
      },
    });

    if (res.statusCode !== 202) {
      console.log(res.payload);
    }
    expect(res.statusCode).toBe(202);
    expect(recorded).toBe(true);
  });

  it("A missing pool yields the named configuration refusal", async () => {
    const livePlan = async () => ({ meta: PLAN_ROW as never, blocks: [] });

    await expect(
      planVerbsFor(PLAN_ROW as never, { livePlan, pool: undefined }),
    ).rejects.toThrow(
      "recording a Refine ask needs the pool the plans registration supplies",
    );
  });
});
