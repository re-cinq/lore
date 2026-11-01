import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerEnableTaskNotificationsTool } from "./enable-task-notifications.js";
import { registerDisableTaskNotificationsTool } from "./disable-task-notifications.js";

const fakeHome = mkdtempSync(join(tmpdir(), "lore-notify-home-"));

process.env.HOME = fakeHome;
mkdirSync(join(fakeHome, ".lore"), { recursive: true });

const enable = toolHandlers(registerEnableTaskNotificationsTool, "full")[
  "lore_enable_task_notifications"
];
const disable = toolHandlers(registerDisableTaskNotificationsTool, "full")[
  "lore_disable_task_notifications"
];
const textOf = async (args: Record<string, unknown>) =>
  (await enable(args)).content[0].text;

describe("lore_enable_task_notifications", () => {
  beforeEach(() => {
    vi.stubEnv("LORE_API_URL", "");
    vi.stubEnv("LORE_INGEST_TOKEN", "");
  });
  afterEach(async () => {
    await disable({});
    vi.unstubAllEnvs();
  });

  it("watches re-cinq/lore for runbook and gap-fill tasks by default", async () => {
    expect(await textOf({ repos: ["re-cinq/lore"] })).toBe(
      "Watching for pending tasks on re-cinq/lore.\nTypes: runbook, gap-fill\nCheck the statusline for new tasks.",
    );
  });

  it("watches the given task types", async () => {
    expect(
      await textOf({ repos: ["a/b", "c/d"], task_types: ["review"] }),
    ).toBe(
      "Watching for pending tasks on a/b, c/d.\nTypes: review\nCheck the statusline for new tasks.",
    );
  });

  it("watches the checkout's own repo when no repos are given", async () => {
    expect(await textOf({})).toMatch(
      /^Watching for pending tasks on [^/\s]+\/[^/\s]+\.\n/,
    );
  });

  it("refuses an empty repo list", async () => {
    expect(await textOf({ repos: [] })).toBe(
      "Error: no repos to watch. Pass repos explicitly or run from a git repo with a GitHub remote.",
    );
  });

  it("reports an already running notifier", async () => {
    await textOf({ repos: ["re-cinq/lore"] });

    expect(await textOf({ repos: ["re-cinq/lore"] })).toBe(
      "Task notifications already active.",
    );
  });
});
