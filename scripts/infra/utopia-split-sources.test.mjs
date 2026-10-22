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

const NEWER_COVERAGE = { id: "src-new-cov", name: "test-coverage" };
const BASE_SOURCES = [
  { id: "src-old", name: "lore" },
  NEWER_COVERAGE,
  { id: "src-docs", name: "docs" },
];

/** A Lore and a Utopia in one server: re-cinq/lore's base holds its old source `src-old` and, made since, a newer `test-coverage` source. */
async function stubbed(
  run,
  { sources = BASE_SOURCES, utopiaStatus = null, trackerPages = [1] } = {},
) {
  const calls = [];
  let trackerWalks = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    const route = `${req.method} ${url.pathname}`;
    const answer = (status, body) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    let body = "";

    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls.push(
        `${route} ${req.headers.authorization}${body ? ` ${body}` : ""}`,
      );

      if (utopiaStatus && url.pathname.startsWith("/api/v1/")) {
        res.statusCode = utopiaStatus;
        res.setHeader("location", "https://utopia.example/oauth2/start");
        res.setHeader("content-type", "text/html");

        return res.end("<html>sign in</html>");
      }

      if (route === "GET /api/repos") {
        return answer(200, {
          repos: [
            { full_name: "re-cinq/lore" },
            { full_name: "re-cinq/bare" },
          ],
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

      if (route === "GET /api/v1/kbs/kb-1/sources") {
        return answer(200, { sources });
      }

      if (/^PATCH \/api\/v1\/kbs\/kb-1\/sources\/[\w-]+$/.test(route)) {
        return answer(200, { source: {} });
      }

      if (route === "POST /api/repos/re-cinq/lore/utopia/reset") {
        return answer(200, {
          cursors_cleared: ["commits_head", "tracker_since"],
        });
      }

      if (route === "POST /api/repos/re-cinq/lore/utopia/tracker") {
        const entries =
          trackerPages[Math.min(trackerWalks++, trackerPages.length - 1)];

        return answer(200, { entries, failed: [] });
      }

      if (route === "POST /api/repos/re-cinq/lore/utopia/backfill") {
        return answer(200, { documents: 3, failed: [] });
      }

      return answer(404, { error: route });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    return await run({ base, calls });
  } finally {
    server.close();
  }
}

function runScript(base, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [script, ...args], {
      env: {
        PATH: process.env.PATH,
        LORE_API_URL: base,
        LORE_ADMIN_TOKEN: "lore-admin",
        UTOPIA_API_URL: base,
        UTOPIA_SESSION_TOKEN: "utopia-session",
        ...env,
      },
    });
    let output = "";

    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status, output }));
  });
}

const writes = (calls) =>
  calls.filter((call) => /^(DELETE|PATCH|POST) /.test(call));

test("without --apply it says it would name src-old test-coverage and set 1 other source aside, and changes nothing", async () => {
  await stubbed(async ({ base, calls }) => {
    const { status, output } = await runScript(base, []);

    assert.equal(status, 0);
    assert.match(
      output,
      /re-cinq\/lore: would name source src-old test-coverage, setting aside 1 other source of that name/,
    );
    assert.match(output, /re-cinq\/bare: skipped, no Utopia knowledge base/);
    assert.deepEqual(writes(calls), []);
  });
});

test("with --apply it sets src-new-cov aside, names src-old test-coverage, then resets, backfills and walks the tracker, and deletes nothing", async () => {
  await stubbed(async ({ base, calls }) => {
    const { status } = await runScript(base, ["--apply", "re-cinq/lore"]);

    assert.equal(status, 0);
    assert.deepEqual(writes(calls), [
      'PATCH /api/v1/kbs/kb-1/sources/src-new-cov Bearer utopia-session {"name":"test-coverage-unused"}',
      'PATCH /api/v1/kbs/kb-1/sources/src-old Bearer utopia-session {"name":"test-coverage"}',
      "POST /api/repos/re-cinq/lore/utopia/reset Bearer lore-admin",
      "POST /api/repos/re-cinq/lore/utopia/backfill Bearer lore-admin",
      "POST /api/repos/re-cinq/lore/utopia/tracker Bearer lore-admin",
    ]);
  });
});

test("a source already named test-coverage is left as it is, and the repo is still reset and backfilled", async () => {
  await stubbed(
    async ({ base, calls }) => {
      const { status, output } = await runScript(base, [
        "--apply",
        "re-cinq/lore",
      ]);

      assert.equal(status, 0);
      assert.match(output, /source src-old is already named test-coverage/);
      assert.deepEqual(
        writes(calls).filter((call) => call.startsWith("PATCH")),
        [],
      );
      assert.equal(
        writes(calls).some((call) => call.includes("/utopia/backfill")),
        true,
      );
    },
    { sources: [{ id: "src-old", name: "test-coverage" }] },
  );
});

test("it walks the issues and pull requests again while a walk returns a full 200, and stops at the walk that returns fewer", async () => {
  await stubbed(
    async ({ base, calls }) => {
      const { status } = await runScript(base, ["--apply", "re-cinq/lore"]);

      assert.equal(status, 0);
      assert.equal(
        calls.filter((call) => call.includes("/utopia/tracker")).length,
        3,
      );
    },
    { trackerPages: [200, 200, 37] },
  );
});

test("a Utopia that redirects to a sign-in says UTOPIA_API_URL is the public address, and changes nothing", async () => {
  await stubbed(
    async ({ base, calls }) => {
      const { status, output } = await runScript(base, [
        "--apply",
        "re-cinq/lore",
      ]);

      assert.equal(status, 1);
      assert.match(output, /answered 302, a redirect to a sign-in/);
      assert.match(output, /port-forward/);
      assert.deepEqual(writes(calls), []);
    },
    { utopiaStatus: 302 },
  );
});

test("a Utopia that refuses the session token names the status and what it said, and nothing is reset", async () => {
  await stubbed(
    async ({ base, calls }) => {
      const { status, output } = await runScript(base, [
        "--apply",
        "re-cinq/lore",
      ]);

      assert.equal(status, 1);
      assert.match(output, /answered HTTP 401: <html>sign in<\/html>/);
      assert.deepEqual(writes(calls), []);
    },
    { utopiaStatus: 401 },
  );
});

test("without UTOPIA_SESSION_TOKEN it stops before any request", async () => {
  await stubbed(async ({ base, calls }) => {
    const { status } = await runScript(base, [], { UTOPIA_SESSION_TOKEN: "" });

    assert.equal(status, 1);
    assert.deepEqual(calls, []);
  });
});
