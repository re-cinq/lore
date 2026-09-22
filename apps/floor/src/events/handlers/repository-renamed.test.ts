import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";

const repoSettings = new InMemorySettings();

vi.mock("../../outbound/queues.js", () => ({
  clusterAgent: () => ({}),
  pipeline: () => ({}),
  eventReporter: () => ({}),
  settings: () => repoSettings,
  taskStore: () => ({}),
}));

vi.mock("../../outbound/db.js", () => ({ getPool: () => ({}) }));

const { repositoryRenamed } = await import("./github.js");

const RENAME = { from: "re-cinq/HAL-engine", to: "re-cinq/HALEngine" };

beforeEach(() => {
  repoSettings.repos.splice(0);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repositoryRenamed", () => {
  it("renames the re-cinq/HAL-engine row to re-cinq/HALEngine and logs renamed", async () => {
    repoSettings.repos.push({ full_name: "re-cinq/HAL-engine" });

    await repositoryRenamed(RENAME);

    expect(await repoSettings.allRepos()).toEqual(["re-cinq/HALEngine"]);
    expect(console.log).toHaveBeenCalledWith(
      "[floor] repository re-cinq/HAL-engine renamed to re-cinq/HALEngine: renamed",
    );
  });

  it("folds re-cinq/HAL-engine into an existing re-cinq/HALEngine row and logs merged", async () => {
    repoSettings.repos.push(
      { full_name: "re-cinq/HAL-engine" },
      { full_name: "re-cinq/HALEngine" },
    );

    await repositoryRenamed(RENAME);

    expect(await repoSettings.allRepos()).toEqual(["re-cinq/HALEngine"]);
    expect(console.log).toHaveBeenCalledWith(
      "[floor] repository re-cinq/HAL-engine renamed to re-cinq/HALEngine: merged",
    );
  });
});
