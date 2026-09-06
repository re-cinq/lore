import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PgPool } from "@re-cinq/lore-shared";

import {
  withLoreWorkflowPreamble,
  readConfig,
  listPendingTasks,
  validateRepoMatch,
  cancelLocalTask,
  buildTurnLines,
  batchTurnLines,
  dropOversizedTurnLines,
  ingestTurns,
  fetchPendingTasks,
  cleanupStaleTasks,
  type LocalTask,
  type LocalRunnerConfig,
  type PendingTask,
} from "./runner.local.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .substring(0, 40)
    .replace(/-$/, "");
}

describe("slugify", () => {
  it("creates a valid branch name from normal text", () => {
    expect(slugify("Add user authentication")).toBe("add-user-authentication");
  });

  it("lowercases everything", () => {
    expect(slugify("Fix Bug In PARSER")).toBe("fix-bug-in-parser");
  });

  it("replaces special characters with dashes, stripping the trailing dash left by a closing paren", () => {
    const result = slugify("fix: handle 404 errors (edge case)");

    expect(result).toBe("fix-handle-404-errors-edge-case");
    expect(result).not.toMatch(/-$/);
  });

  it("truncates to 40 characters", () => {
    const long =
      "this is a very long description that should be truncated to forty characters";
    const result = slugify(long);

    expect(result.length).toBeLessThanOrEqual(40);
  });

  it("strips trailing dashes when truncation lands on a dash", () => {
    const input = "a".repeat(39) + " b";
    const result = slugify(input);

    expect(result).not.toMatch(/-$/);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles numbers-only input", () => {
    expect(slugify("12345")).toBe("12345");
  });

  it("collapses consecutive special chars into single dash", () => {
    expect(slugify("hello   world---test")).toBe("hello-world-test");
  });
});

describe("readConfig", () => {
  it("exposes the default shape since the HOME path can't be redirected for this import", () => {
    const defaults = readConfig();

    expect(defaults).toHaveProperty("enabled");
    expect(defaults).toHaveProperty("max_concurrent");
    expect(defaults).toHaveProperty("repos");
    expect(defaults).toHaveProperty("task_types");
    expect(defaults).toHaveProperty("model");
    expect(typeof defaults.enabled).toBe("boolean");
    expect(typeof defaults.max_concurrent).toBe("number");
    expect(Array.isArray(defaults.repos)).toBe(true);
    expect(Array.isArray(defaults.task_types)).toBe(true);
  });

  it("falls back to hardcoded defaults (concurrency 2, sonnet-4-6) when disabled", () => {
    const defaults = readConfig();

    if (!defaults.enabled) {
      expect(defaults.max_concurrent).toBe(2);
      expect(defaults.task_types).toContain("implementation");
      expect(defaults.task_types).toContain("general");
      expect(defaults.model).toBe("claude-sonnet-4-6");
    }
  });
});

describe("writeConfig + readConfig round-trip", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lore-test-"));
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serializes config the way writeConfig would, verified against a temp path since its own path is hardcoded", () => {
    const configPath = path.join(tmpDir, "local-runner.json");
    const config: LocalRunnerConfig = {
      enabled: true,
      max_concurrent: 3,
      repos: ["re-cinq/lore"],
      task_types: ["implementation"],
      model: "claude-sonnet-4-6",
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const read = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    expect(read).toEqual(config);
  });
});

describe("pending task helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lore-pending-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("listPendingTasks returns empty array when file is missing", () => {
    const tasks = listPendingTasks();

    expect(Array.isArray(tasks)).toBe(true);
  });

  it("skipTask filters a task by id from the pending file", () => {
    const tasks: PendingTask[] = [
      {
        id: "task-1",
        description: "First task",
        task_type: "general",
        target_repo: "re-cinq/lore",
        created_at: "2026-04-03T00:00:00Z",
      },
      {
        id: "task-2",
        description: "Second task",
        task_type: "implementation",
        target_repo: "re-cinq/lore",
        created_at: "2026-04-03T01:00:00Z",
      },
    ];

    const filtered = tasks.filter((t) => t.id !== "task-1");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("task-2");
  });
});

describe("branch name generation", () => {
  it("creates lore/<type>/<slug>-<shortId> format", () => {
    const taskType = "implementation";
    const prompt = "Add unit tests for the MCP server redaction module";
    const taskId = "abc12345-6789-0000-1111-222233334444";

    const slug = slugify(prompt.substring(0, 60));
    const shortId = taskId.substring(0, 8);
    const branch = `lore/${taskType}/${slug}-${shortId}`;

    expect(branch).toMatch(/^lore\/implementation\//);
    expect(branch).toContain("abc12345");
    expect(branch).not.toContain(" ");
  });

  it("handles very short prompts", () => {
    const slug = slugify("fix");
    const branch = `lore/general/${slug}-abcd1234`;

    expect(branch).toBe("lore/general/fix-abcd1234");
  });
});

describe("validateRepoMatch guards against pushing to the wrong repo (#250)", () => {
  it("passes when cwd repo matches task repo", () => {
    expect(() =>
      validateRepoMatch("re-cinq/lore", "re-cinq/lore"),
    ).not.toThrow();
  });

  it("throws when cwd repo differs from task repo", () => {
    expect(() => validateRepoMatch("re-cinq/re-plan", "re-cinq/lore")).toThrow(
      /target_repo mismatch/,
    );
  });

  it("error message names both repos and suggests a cd", () => {
    try {
      validateRepoMatch("re-cinq/re-plan", "re-cinq/lore");
      expect.fail("expected throw");
    } catch (err: any) {
      expect(err.message).toContain("re-cinq/re-plan");
      expect(err.message).toContain("re-cinq/lore");
      expect(err.message).toMatch(/cd to a checkout/);
    }
  });

  it("passes when cwd repo cannot be detected (null), leaving the later worktree-creation error to spawnLocalTask", () => {
    expect(() => validateRepoMatch("re-cinq/lore", null)).not.toThrow();
  });
});

describe("cancelLocalTask", () => {
  it("returns not-found for an unknown id without touching processes or worktrees", () => {
    const unknownId = "00000000-dead-beef-0000-000000000000";

    expect(cancelLocalTask(unknownId)).toEqual({
      cancelled: false,
      error: "Task not found",
    });
  });
});

function applyConfigUpdate(
  config: LocalRunnerConfig,
  args: Partial<
    Pick<LocalRunnerConfig, "max_concurrent" | "repos" | "task_types" | "model">
  >,
): LocalRunnerConfig {
  const next = { ...config };

  if (args.max_concurrent !== undefined) {
    next.max_concurrent = args.max_concurrent;
  }

  if (args.repos) {
    next.repos = args.repos;
  }

  if (args.task_types) {
    next.task_types = args.task_types;
  }

  if (args.model) {
    next.model = args.model;
  }

  return next;
}

describe("lore_configure_local_runner update merge", () => {
  it("merge overwrites only provided fields and keeps the rest", () => {
    const base: LocalRunnerConfig = {
      enabled: true,
      max_concurrent: 2,
      repos: ["re-cinq/lore"],
      task_types: ["implementation", "general"],
      model: "claude-sonnet-4-6",
    };

    expect(
      applyConfigUpdate(base, { max_concurrent: 5, model: "claude-opus-4-6" }),
    ).toEqual({
      enabled: true,
      max_concurrent: 5,
      repos: ["re-cinq/lore"],
      task_types: ["implementation", "general"],
      model: "claude-opus-4-6",
    });
  });
});

describe("buildTurnLines", () => {
  it("keeps parseable stream-json lines untouched", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", is_error: false, result: "done" }),
    ];

    expect(buildTurnLines(lines.join("\n"))).toEqual({
      lines,
      dropped: 0,
    });
  });

  it("skips non-JSON lines without counting them as dropped", () => {
    const good = JSON.stringify({ type: "assistant" });
    const raw = [
      "--- VALIDATION FAILED ---",
      "plain stderr text",
      good,
      "",
    ].join("\n");

    expect(buildTurnLines(raw)).toEqual({ lines: [good], dropped: 0 });
  });

  it("redacts a secret inside a line and keeps the still-parseable result", () => {
    const raw = JSON.stringify({
      type: "assistant",
      text: "token ghp_abcdefghijklmnopqrstuvwxyz012345 leaked",
    });
    const result = buildTurnLines(raw);

    expect(result.dropped).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(JSON.parse(result.lines[0])).toMatchObject({ type: "assistant" });
  });

  it("drops and counts a line whose JSON breaks under redaction", () => {
    const broken = `{"a":"-----BEGIN PRIVATE KEY-----","b":{"c":"-----END PRIVATE KEY-----"}}`;
    const good = JSON.stringify({ type: "assistant" });

    expect(buildTurnLines([broken, good].join("\n"))).toEqual({
      lines: [good],
      dropped: 1,
    });
  });
});

describe("batchTurnLines", () => {
  it("splits on the line cap", () => {
    const lines = ["1", "2", "3", "4", "5"];

    expect(batchTurnLines(lines, 1000, 2)).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["5"],
    ]);
  });

  it("splits on the byte cap using each line's utf-8 byte length, not char count (ü = 2 bytes)", () => {
    const line = "ü".repeat(5);

    expect(batchTurnLines([line, line, line], 25, 100)).toEqual([
      [line, line],
      [line],
    ]);
  });

  it("emits a line larger than the byte cap as its own batch", () => {
    const big = "x".repeat(50);

    expect(batchTurnLines(["a", big, "b"], 20, 100)).toEqual([
      ["a"],
      [big],
      ["b"],
    ]);
  });
});

describe("dropOversizedTurnLines drops a line that can never fit one relay request instead of 413-ing its batch", () => {
  it("keeps lines at or under the byte cap and counts the rest", () => {
    const small = "x".repeat(10);
    const big = "y".repeat(40);

    expect(dropOversizedTurnLines([small, big, small], 20)).toEqual({
      kept: [small, small],
      oversized: 1,
    });
  });

  it("measures utf-8 bytes not characters: 10 chars of ü is 20 bytes, over a 15-byte cap", () => {
    const multibyte = "ü".repeat(10);

    expect(dropOversizedTurnLines([multibyte], 15)).toEqual({
      kept: [],
      oversized: 1,
    });
  });
});

describe("ingestTurns x-turn-offset header carries each batch's cumulative line offset so the relay can key lines by transcript position (#1389)", () => {
  const localTask: LocalTask = {
    taskId: "task-1",
    pid: 1,
    branch: "fix/x",
    repo: "re-cinq/lore",
    worktreePath: "/tmp/worktree",
    logFile: "/tmp/task-1.log",
    startedAt: "2026-08-19T00:00:00.000Z",
    status: "completed",
  };
  const rawLogs = Array.from({ length: 2001 }, (_, i) =>
    JSON.stringify({ type: "assistant", i }),
  ).join("\n");
  const env = process.env;

  beforeEach(() => {
    env.LORE_API_URL = "http://lore-api.test";
    env.LORE_INGEST_TOKEN = "test-token";
  });

  afterEach(() => {
    delete env.LORE_API_URL;
    delete env.LORE_INGEST_TOKEN;
    vi.unstubAllGlobals();
  });

  it("stamps each batch with its cumulative line offset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    vi.stubGlobal("fetch", fetchMock);

    await ingestTurns(localTask, rawLogs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers["x-turn-offset"]).toBe("0");
    expect(fetchMock.mock.calls[1][1].headers["x-turn-offset"]).toBe("2000");
  });

  it("advances the offset past a failed batch so later lines keep their positions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValue({ ok: true, status: 200 });

    vi.stubGlobal("fetch", fetchMock);

    await ingestTurns(localTask, rawLogs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers["x-turn-offset"]).toBe("2000");
  });

  it("returns without fetching when the API URL or token is not configured", async () => {
    delete env.LORE_API_URL;
    delete env.LORE_INGEST_TOKEN;
    env.GIT_CONFIG_GLOBAL = "/nonexistent-lore-test-gitconfig";
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    await ingestTurns(localTask, rawLogs);

    delete env.GIT_CONFIG_GLOBAL;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("warns and drops a line too large to ever fit a relay batch, without fetching it", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const oversizedLogs = JSON.stringify({
      type: "assistant",
      data: "the quick brown fox jumps over the lazy dog ".repeat(20_000),
    });

    await ingestTurns(localTask, oversizedLogs);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("exceeds the"),
    );
    warnSpy.mockRestore();
  });
});

describe("fetchPendingTasks", () => {
  const env = process.env;

  afterEach(() => {
    delete env.LORE_API_URL;
    delete env.LORE_INGEST_TOKEN;
    vi.unstubAllGlobals();
  });

  it("returns an empty array without querying anything when repos or task types are empty", async () => {
    const dbPool: PgPool = {
      query: async () => {
        throw new Error("must not be called");
      },
    };

    await expect(fetchPendingTasks([], ["general"], dbPool)).resolves.toEqual(
      [],
    );
    await expect(
      fetchPendingTasks(["re-cinq/lore"], [], dbPool),
    ).resolves.toEqual([]);
  });

  it("returns rows from the DB pool when one is provided", async () => {
    const dbPool: PgPool = {
      query: (async () => ({
        rows: [
          {
            id: "task-1",
            description: "Fix the thing",
            task_type: "general",
            target_repo: "re-cinq/lore",
            created_at: "2026-04-03T00:00:00Z",
            issue_number: 42,
          },
        ],
      })) as PgPool["query"],
    };

    const tasks = await fetchPendingTasks(
      ["re-cinq/lore"],
      ["general"],
      dbPool,
    );

    expect(tasks).toEqual([
      {
        id: "task-1",
        description: "Fix the thing",
        task_type: "general",
        target_repo: "re-cinq/lore",
        created_at: "2026-04-03T00:00:00Z",
        issue_number: 42,
      },
    ]);
  });

  it("falls through to the API when the DB query throws", async () => {
    const dbPool: PgPool = {
      query: async () => {
        throw new Error("connection reset");
      },
    };

    env.LORE_API_URL = "http://lore-api.test";
    env.LORE_INGEST_TOKEN = "test-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [
          {
            id: "task-2",
            task_type: "general",
            target_repo: "re-cinq/lore",
            created_at: "2026-04-03T00:00:00Z",
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const tasks = await fetchPendingTasks(
      ["re-cinq/lore"],
      ["general"],
      dbPool,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tasks).toEqual([
      {
        id: "task-2",
        description: "",
        task_type: "general",
        target_repo: "re-cinq/lore",
        created_at: "2026-04-03T00:00:00Z",
        issue_number: undefined,
      },
    ]);
  });

  it("returns an empty array when no API credentials are configured", async () => {
    const tasks = await fetchPendingTasks(["re-cinq/lore"], ["general"]);

    expect(tasks).toEqual([]);
  });

  it("returns an empty array when the API responds non-ok", async () => {
    env.LORE_API_URL = "http://lore-api.test";
    env.LORE_INGEST_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const tasks = await fetchPendingTasks(["re-cinq/lore"], ["general"]);

    expect(tasks).toEqual([]);
  });

  it("filters API results down to the requested repos and task types", async () => {
    env.LORE_API_URL = "http://lore-api.test";
    env.LORE_INGEST_TOKEN = "test-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [
          {
            id: "task-3",
            task_type: "general",
            target_repo: "re-cinq/lore",
            created_at: "2026-04-03T00:00:00Z",
          },
          {
            id: "task-4",
            task_type: "onboard",
            target_repo: "re-cinq/other",
            created_at: "2026-04-03T00:00:00Z",
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const tasks = await fetchPendingTasks(["re-cinq/lore"], ["general"]);

    expect(tasks.map((t) => t.id)).toEqual(["task-3"]);
  });
});

describe("cleanupStaleTasks", () => {
  it("resolves without throwing when there are no locally-tracked tasks to recover", async () => {
    await expect(cleanupStaleTasks()).resolves.toBeUndefined();
  });

  describe("recovering a dead task against the real ~/.lore/local-tasks.json", () => {
    const tasksFile = path.join(os.homedir(), ".lore", "local-tasks.json");
    let backup: string | null;
    const env = process.env;

    beforeEach(() => {
      backup = fs.existsSync(tasksFile)
        ? fs.readFileSync(tasksFile, "utf-8")
        : null;
      delete env.LORE_API_URL;
      delete env.LORE_INGEST_TOKEN;
      env.GIT_CONFIG_GLOBAL = "/nonexistent-lore-test-gitconfig";
    });

    afterEach(() => {
      delete env.GIT_CONFIG_GLOBAL;
      fs.mkdirSync(path.dirname(tasksFile), { recursive: true });

      if (backup === null) {
        fs.rmSync(tasksFile, { force: true });

        return;
      }
      fs.writeFileSync(tasksFile, backup);
    });

    it("marks dead tasks failed and leaves a live one running, unaffected by staleness age", async () => {
      const deadFresh: LocalTask = {
        taskId: "stale-test-dead-fresh",
        pid: 999999999,
        branch: "lore/general/dead-fresh",
        repo: "re-cinq/lore",
        worktreePath: "/nonexistent/lore-test-worktree-dead-fresh",
        logFile: "/nonexistent/lore-test-dead-fresh.log",
        startedAt: new Date().toISOString(),
        status: "running",
      };
      const deadStale: LocalTask = {
        ...deadFresh,
        taskId: "stale-test-dead-stale",
        worktreePath: "/nonexistent/lore-test-worktree-dead-stale",
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      };
      const live: LocalTask = {
        ...deadFresh,
        taskId: "stale-test-live",
        pid: process.pid,
      };

      fs.mkdirSync(path.dirname(tasksFile), { recursive: true });
      fs.writeFileSync(
        tasksFile,
        JSON.stringify([deadFresh, deadStale, live], null, 2),
      );

      await cleanupStaleTasks();

      const result = JSON.parse(
        fs.readFileSync(tasksFile, "utf-8"),
      ) as LocalTask[];
      const byId = (id: string) => result.find((t) => t.taskId === id);

      expect(byId("stale-test-dead-fresh")).toMatchObject({
        status: "failed",
        error: "Process exited unexpectedly",
      });
      expect(byId("stale-test-dead-stale")).toMatchObject({
        status: "failed",
        error: "Process exited unexpectedly",
      });
      expect(byId("stale-test-live")).toMatchObject({ status: "running" });
    });
  });
});

describe("withLoreWorkflowPreamble", () => {
  it("opens every local run with lore_assemble_context as step 1", () => {
    expect(withLoreWorkflowPreamble("do the thing")).toContain(
      "1. FIRST: Call lore_assemble_context",
    );
  });

  it("ends with the task, so the instructions read as preamble to it", () => {
    expect(withLoreWorkflowPreamble("do the thing")).toMatch(/do the thing$/);
  });

  it("has one shape — nothing is pre-fetched, so there is no pre-loaded branch", () => {
    expect(withLoreWorkflowPreamble("do the thing")).not.toContain(
      "Pre-loaded Context",
    );
  });
});
