import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "utopia-split-sources.sh",
);

/** A Lore and a Utopia in one server: the old source of re-cinq/lore holds d1 and d2 live and d3 deleted. */
async function stubbed(run, { failPurge = null } = {}) {
  const live = ["d1", "d2"];
  const deleted = ["d3"];
  const calls = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    const route = `${req.method} ${url.pathname}`;
    const token = req.headers.authorization;
    const answer = (status, body) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };

    req.resume();
    calls.push(`${route} ${token}`);

    if (route === "GET /api/repos") {
      return answer(200, {
        repos: [{ full_name: "re-cinq/lore" }, { full_name: "re-cinq/bare" }],
        total: 2,
      });
    }

    if (route === "GET /api/repos/re-cinq/lore") {
      return answer(200, {
        settings: { utopia: { kb_id: "kb-1", source_id: "src-old" } },
      });
    }

    if (route === "GET /api/repos/re-cinq/bare") {
      return answer(200, { settings: {} });
    }

    if (route === "GET /api/v1/kbs/kb-1/documents") {
      const ids = url.searchParams.get("state") === "deleted" ? deleted : live;

      return answer(200, {
        docs: ids.map((id) => ({ id })),
        total: ids.length,
      });
    }
    const document = /^\/api\/v1\/documents\/(\w+)(\/purge)?$/.exec(url.pathname);

    if (document && req.method === "DELETE") {
      live.splice(live.indexOf(document[1]), 1);
      deleted.push(document[1]);

      return answer(200, { ok: true });
    }

    if (document && document[2] && req.method === "POST") {
      if (document[1] === failPurge) {
        return answer(500, { error: "boom" });
      }
      deleted.splice(deleted.indexOf(document[1]), 1);

      return answer(200, { ok: true });
    }

    if (route === "POST /api/repos/re-cinq/lore/utopia/reset") {
      return answer(200, { ingest_state_cleared: 2 });
    }

    if (route === "POST /api/repos/re-cinq/lore/utopia/backfill") {
      return answer(200, { documents: 3, failed: [] });
    }

    return answer(404, { error: route });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    return await run({ base, calls });
  } finally {
    server.close();
  }
}

function runScript(base, args) {
  return new Promise((resolve) => {
    const child = spawn("bash", [script, ...args], {
      env: {
        PATH: process.env.PATH,
        LORE_API_URL: base,
        LORE_ADMIN_TOKEN: "lore-admin",
        UTOPIA_API_URL: base,
        UTOPIA_SESSION_TOKEN: "utopia-session",
      },
    });
    let output = "";

    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status, output }));
  });
}

const writes = (calls) =>
  calls.filter((call) => /^(DELETE|POST) /.test(call));

test("without --apply it counts 2 live and 1 deleted documents of re-cinq/lore's old source and changes nothing", async () => {
  await stubbed(async ({ base, calls }) => {
    const { status, output } = await runScript(base, []);

    assert.equal(status, 0);
    assert.match(output, /re-cinq\/lore: would purge 2 live and 1 deleted documents of source src-old/);
    assert.match(output, /re-cinq\/bare: skipped, no Utopia knowledge base/);
    assert.deepEqual(writes(calls), []);
  });
});

test("with --apply it deletes the 2 live documents, purges all 3 under the session token, then resets and backfills with the admin token", async () => {
  await stubbed(async ({ base, calls }) => {
    const { status } = await runScript(base, ["--apply", "re-cinq/lore"]);

    assert.equal(status, 0);
    assert.deepEqual(writes(calls), [
      "DELETE /api/v1/documents/d1 Bearer utopia-session",
      "POST /api/v1/documents/d1/purge Bearer utopia-session",
      "DELETE /api/v1/documents/d2 Bearer utopia-session",
      "POST /api/v1/documents/d2/purge Bearer utopia-session",
      "POST /api/v1/documents/d3/purge Bearer utopia-session",
      "POST /api/repos/re-cinq/lore/utopia/reset Bearer lore-admin",
      "POST /api/repos/re-cinq/lore/utopia/backfill Bearer lore-admin",
    ]);
  });
});

test("a purge Utopia refuses for d2 fails the repo, exits 1, and neither resets nor backfills it", async () => {
  await stubbed(
    async ({ base, calls }) => {
      const { status, output } = await runScript(base, ["--apply", "re-cinq/lore"]);

      assert.equal(status, 1);
      assert.match(output, /purge of deleted documents failed/);
      assert.equal(
        writes(calls).some((call) => /utopia\/(reset|backfill)/.test(call)),
        false,
      );
    },
    { failPurge: "d2" },
  );
});

test("without UTOPIA_SESSION_TOKEN it stops before any request", async () => {
  await stubbed(async ({ base, calls }) => {
    const child = spawn("bash", [script], {
      env: {
        PATH: process.env.PATH,
        LORE_API_URL: base,
        LORE_ADMIN_TOKEN: "lore-admin",
        UTOPIA_API_URL: base,
      },
    });
    const status = await new Promise((resolve) => child.on("close", resolve));

    assert.equal(status, 1);
    assert.deepEqual(calls, []);
  });
});
