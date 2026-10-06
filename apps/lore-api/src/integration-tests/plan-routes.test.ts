import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../app/build-server.js";
import { restoreEnv } from "./restore-env.js";
import { collabAuthenticator } from "../work/plans/collab-tokens.js";
import {
  planRun,
  planVisit,
  recordedPlanFloor,
  type PlanFloorScene,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import { specBranchOf } from "../work/plans/spec-branch.js";

const TOKEN = "test-plan-routes-token";
const READ_TOKEN = "test-plan-routes-read-token";
const REPO = "acme/plan-routes";
const NEW_PLAN = {
  repo: REPO,
  title: "Faster checkout",
  type: "feature",
  createdBy: "ana",
};

const SUCCESS = { outcome: "success" };
const ON_AUTHOR = [
  planVisit("analyze", SUCCESS),
  planVisit("plan-pass-end", SUCCESS),
  planVisit("author", null),
];
const WHILE_ANALYZING = [
  planVisit("author", SUCCESS),
  planVisit("analyze", null),
];

describe("/api/plans on lore-api", () => {
  let pool: pg.Pool;
  let server: Server;
  let recorded = recordedPlanFloor();

  const onFloor = (scene: PlanFloorScene) => {
    recorded = recordedPlanFloor(scene);
  };

  const floorWrites = () =>
    recorded.requests
      .filter((request) => request.method === "POST")
      .map((request) => request.path);
  const prevToken = process.env.LORE_INGEST_TOKEN;

  const createPlan = async () =>
    (
      (await call("POST", "/api/plans", TOKEN, NEW_PLAN)).body as {
        meta: { id: string };
      }
    ).meta.id;

  const call = async (
    method: string,
    url: string,
    token?: string,
    payload?: object,
  ) => {
    const res = await server.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: payload ? JSON.stringify(payload) : undefined,
    });

    return { status: res.statusCode, body: JSON.parse(res.payload) as unknown };
  };

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query(
      `INSERT INTO pipeline.api_tokens (name, token_hash, scopes, created_by)
       VALUES ('plan-routes-read', $1, '{read}', 'test') ON CONFLICT (token_hash) DO NOTHING`,
      [createHash("sha256").update(READ_TOKEN).digest("hex")],
    );
    server = buildServer(() => pool, 0, {
      get floor() {
        return recorded.floor;
      },
      specBranch: async (plan) => specBranchOf(plan),
      baseBranch: () => Promise.resolve("main"),
      specPrState: () => Promise.resolve(null),
      recordRefineAsk: () => Promise.resolve(),
      pulls: {
        listReviewThreads: async () => [],
        listComments: async () => [],
        listReviews: async () => [],
      },
    });
  });

  beforeEach(() => onFloor({}));

  afterAll(async () => {
    await pool.query("DELETE FROM lore.plans WHERE repo = $1", [REPO]);
    await pool.query(
      "DELETE FROM pipeline.api_tokens WHERE name = 'plan-routes-read'",
    );
    await pool.end();
    restoreEnv("LORE_INGEST_TOKEN", prevToken);
  });

  it("answers 401 to a plan read without a bearer token", async () => {
    expect(
      (await call("GET", "/api/plans/00000000-0000-0000-0000-000000000000"))
        .status,
    ).toBe(401);
  });

  it("answers 403 to a plan created with a read-only token", async () => {
    expect(
      (await call("POST", "/api/plans", READ_TOKEN, NEW_PLAN)).status,
    ).toBe(403);
  });

  it("creates a plan with a write token and reads back its feature sections", async () => {
    const created = await call("POST", "/api/plans", TOKEN, NEW_PLAN);
    const planId = (created.body as { meta: { id: string } }).meta.id;
    const read = await call("GET", `/api/plans/${planId}`, READ_TOKEN);

    expect(read).toMatchObject({
      status: 200,
      body: {
        json: {
          title: "Faster checkout",
          sections: expect.arrayContaining([
            expect.objectContaining({ slot: "intent" }),
          ]),
        },
      },
    });
  });

  it("lists the plan Ana created as a draft feature of the repo", async () => {
    const planId = await createPlan();
    const listed = await call("GET", `/api/repos/${REPO}/plans`, READ_TOKEN);

    expect(listed).toMatchObject({
      status: 200,
      body: {
        plans: expect.arrayContaining([
          expect.objectContaining({
            id: planId,
            type: "feature",
            status: "draft",
          }),
        ]),
      },
    });
  });

  it("mints a collab token that opens the plan as Ana", async () => {
    const planId = await createPlan();
    const minted = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/collab-token`,
      TOKEN,
      {
        user: { id: "ana", name: "Ana" },
        role: "write",
      },
    );
    const { token } = minted.body as { token: string };

    expect(
      await collabAuthenticator(() => pool).authenticate(token, {
        repo: REPO,
        planId,
      }),
    ).toEqual({
      id: "ana",
      name: "Ana",
      role: "write",
    });
  });

  it("answers 404 to a collab token for the plan under another repo", async () => {
    const planId = await createPlan();
    const minted = await call(
      "POST",
      `/api/repos/acme/other/plans/${planId}/collab-token`,
      TOKEN,
      {
        user: { id: "ana", name: "Ana" },
        role: "write",
      },
    );

    expect(minted.status).toBe(404);
  });

  it("starts the planning agent's draft of Ana's plan as a feature-planning run on the floor", async () => {
    const planId = await createPlan();
    const started = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/drafting`,
      TOKEN,
      {
        known: "Checkout is slow.",
        createdBy: "ana",
      },
    );

    expect({ started, writes: floorWrites() }).toEqual({
      started: { status: 202, body: { task_id: "run-new" } },
      writes: ["/blobs", "/assembly-lines/feature-planning/start"],
    });
  });

  it("answers 409 to a Refine while the planning agent is still working on the plan", async () => {
    const planId = await createPlan();

    onFloor({ runs: [planRun()], visits: { "run-open": WHILE_ANALYZING } });
    const refused = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/refine`,
      TOKEN,
      {
        slot: "intent",
        title: "Intent",
        baseHash: "3f9a",
        inputs: {},
        uses: {},
      },
    );

    expect(refused.status).toBe(409);
  });

  const approvedPlan = async () => {
    const planId = await createPlan();

    await pool.query(
      "UPDATE lore.plans SET status = 'approved', approval = $2 WHERE id = $1",
      [
        planId,
        {
          mode: "manual",
          approvedBy: "ana",
          approvedAt: "2026-09-23T10:00:00.000Z",
          version: 1,
        },
      ],
    );

    return planId;
  };

  it("answers 409 to approving Ana's plan while its sections are still empty, naming what it lacks", async () => {
    const planId = await createPlan();
    const refused = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/approve`,
      TOKEN,
      { approvedBy: "ana" },
    );

    expect(refused).toMatchObject({
      status: 409,
      body: { problems: expect.arrayContaining([expect.any(Object)]) },
    });
  });

  it("starts a fresh spec pass on the floor for Ana's approved plan whose line is not running", async () => {
    const planId = await approvedPlan();
    const started = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/spec-work`,
      TOKEN,
      { createdBy: "ana" },
    );

    expect({ started, writes: floorWrites() }).toEqual({
      started: { status: 202, body: { task_id: "run-new" } },
      writes: ["/blobs", "/assembly-lines/feature-planning/start"],
    });
  });

  it("reopens Ana's approved plan as a draft, and refuses to reopen it twice", async () => {
    const planId = await approvedPlan();
    const reopened = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/reopen`,
      TOKEN,
      { reopenedBy: "ana" },
    );
    const again = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/reopen`,
      TOKEN,
      { reopenedBy: "ana" },
    );

    expect({ reopened, again: again.status }).toMatchObject({
      reopened: { status: 200, body: { status: "draft", approval: null } },
      again: 409,
    });
  });

  it("deletes Ana's plan with its versions, so it no longer reads back", async () => {
    const planId = await createPlan();
    const deleted = await call(
      "DELETE",
      `/api/repos/${REPO}/plans/${planId}`,
      TOKEN,
    );
    const read = await call("GET", `/api/plans/${planId}`, READ_TOKEN);
    const versions = await pool.query(
      "SELECT 1 FROM lore.plan_versions WHERE plan_id = $1",
      [planId],
    );

    expect({
      deleted,
      read: read.status,
      versions: versions.rowCount,
    }).toEqual({
      deleted: { status: 200, body: { id: planId } },
      read: 404,
      versions: 0,
    });
  });

  it("answers 404 to deleting Ana's plan under another repo, and keeps it", async () => {
    const planId = await createPlan();
    const deleted = await call(
      "DELETE",
      `/api/repos/acme/elsewhere/plans/${planId}`,
      TOKEN,
    );
    const read = await call("GET", `/api/plans/${planId}`, READ_TOKEN);

    expect({ deleted: deleted.status, read: read.status }).toEqual({
      deleted: 404,
      read: 200,
    });
  });

  it("reopens Ana's approved plan when its planning line waits on the author, and leaves it be once reopened", async () => {
    const planId = await approvedPlan();

    onFloor({ runs: [planRun()], visits: { "run-open": ON_AUTHOR } });
    const opened = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/author-waiting`,
      TOKEN,
    );
    const again = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/author-waiting`,
      TOKEN,
    );
    const { rows } = await pool.query(
      "SELECT status FROM lore.plans WHERE id = $1",
      [planId],
    );

    expect({ opened, again, plan: rows[0] }).toEqual({
      opened: { status: 200, body: { reopened: true } },
      again: { status: 200, body: { reopened: false } },
      plan: { status: "draft" },
    });
  });

  it("leaves Ana's approved plan approved when no planning line waits on its author", async () => {
    const planId = await approvedPlan();
    const answered = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/author-waiting`,
      TOKEN,
    );

    expect(answered).toEqual({ status: 200, body: { reopened: false } });
  });

  const planMd = async (planId: string) =>
    (
      await server.inject({
        method: "GET",
        url: `/api/plans/${planId}/markdown`,
        headers: { authorization: `Bearer ${READ_TOKEN}` },
      })
    ).payload;

  it("serves Ana's plan as the plan.md a planning pod edits, one marked heading per section", async () => {
    const planId = await createPlan();

    expect(await planMd(planId)).toContain(
      "## What we want and why <!-- slot:intent -->",
    );
  });

  it("writes a draft's plan.md into Ana's live plan as the planning agent's edits", async () => {
    const planId = await createPlan();
    const markdown = (await planMd(planId)).replace(
      "## What we want and why <!-- slot:intent -->\n",
      "## What we want and why <!-- slot:intent -->\n\nCheckout p95 is 450 ms.\n",
    );
    const written = await call(
      "POST",
      `/api/plans/${planId}/agent-file`,
      TOKEN,
      {
        actor: "planning-agent",
        markdown,
        refine: null,
      },
    );

    expect({
      written,
      after: (await planMd(planId)).includes("Checkout p95 is 450 ms."),
    }).toMatchObject({
      written: { status: 200, body: { written: 1, problems: [] } },
      after: true,
    });
  });

  it("writes a 3 MB draft of short paragraphs into Ana's live plan and serves it back whole", async () => {
    const planId = await createPlan();
    const paragraphs = Array.from(
      { length: 100_000 },
      (_, n) => `Finding ${n}: "p95" is 450 ms.`,
    ).join("\n\n");
    const markdown = (await planMd(planId)).replace(
      "## What we want and why <!-- slot:intent -->\n",
      `## What we want and why <!-- slot:intent -->\n\n${paragraphs}\n`,
    );
    const written = await call(
      "POST",
      `/api/plans/${planId}/agent-file`,
      TOKEN,
      { actor: "planning-agent", markdown, refine: null },
    );
    const after = await planMd(planId);

    expect({
      bytes: markdown.length > 3_000_000,
      status: written.status,
      last: after.includes('Finding 99999: "p95" is 450 ms.'),
    }).toEqual({ bytes: true, status: 200, last: true });
  });

  it("reads the planning agent's paragraph '### Why\\r\\n- Checkout p95 is 450 ms.' into a heading and a bullet in Ana's live plan", async () => {
    const planId = await createPlan();
    const edited = await call(
      "POST",
      `/api/plans/${planId}/agent-edits`,
      TOKEN,
      {
        actor: "planning-agent",
        ops: [
          {
            op: "append-to-section",
            slot: "intent",
            paragraphs: ["### Why\r\n- Checkout p95 is 450 ms."],
          },
        ],
      },
    );
    const { body } = await call(
      "GET",
      `/api/plans/${planId}/agent-view`,
      READ_TOKEN,
    );
    const { sections } = body as {
      sections: { slot: string; blocks: { type: string; text: string }[] }[];
    };
    const intent = sections.find((section) => section.slot === "intent");

    expect({
      status: edited.status,
      intent: intent?.blocks.map(({ type, text }) => ({ type, text })),
    }).toEqual({
      status: 200,
      intent: [
        { type: "heading", text: "Why" },
        { type: "bulletListItem", text: "Checkout p95 is 450 ms." },
      ],
    });
  });

  it("answers 400 to a plan.md whose only change names no section of Ana's plan", async () => {
    const planId = await createPlan();
    const markdown = `${await planMd(planId)}\n## Rollout <!-- slot:custom-nowhere -->\n\nWaves.\n`;

    expect(
      (
        await call("POST", `/api/plans/${planId}/agent-file`, TOKEN, {
          actor: "planning-agent",
          markdown,
          refine: null,
        })
      ).status,
    ).toBe(400);
  });
});
