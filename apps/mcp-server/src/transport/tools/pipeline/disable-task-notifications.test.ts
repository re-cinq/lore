import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerEnableTaskNotificationsTool } from "./enable-task-notifications.js";
import { registerDisableTaskNotificationsTool } from "./disable-task-notifications.js";

const fakeHome = mkdtempSync(join(tmpdir(), "lore-notify-off-home-"));
const pendingFile = join(fakeHome, ".lore", "pending-tasks.json");

process.env.HOME = fakeHome;
mkdirSync(join(fakeHome, ".lore"), { recursive: true });

const enable = toolHandlers(registerEnableTaskNotificationsTool, "full")[
  "lore_enable_task_notifications"
];
const disable = toolHandlers(registerDisableTaskNotificationsTool, "full")[
  "lore_disable_task_notifications"
];

describe("lore_disable_task_notifications", () => {
  it("stops a running notifier and removes its pending cache", async () => {
    vi.stubEnv("LORE_API_URL", "");
    await enable({ repos: ["re-cinq/lore"] });
    await vi.waitFor(() => expect(existsSync(pendingFile)).toBe(true));

    const result = await disable({});

    expect({
      text: result.content[0].text,
      cacheLeft: existsSync(pendingFile),
      restart: (await enable({ repos: ["re-cinq/lore"] })).content[0].text,
    }).toMatchObject({
      text: "Task notifications stopped.",
      cacheLeft: false,
      restart: expect.stringMatching(/^Watching/),
    });
    await disable({});
    vi.unstubAllEnvs();
  });

  it("answers stopped when no notifier is running", async () => {
    expect((await disable({})).content[0].text).toBe(
      "Task notifications stopped.",
    );
  });
});
