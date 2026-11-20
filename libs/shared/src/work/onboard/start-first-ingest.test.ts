import { describe, expect, it } from "vitest";
import { enforceTrue } from "../../lib/enforce.js";
import { InMemorySettings } from "../../outbound/project/settings/settings-memory.js";
import { Settings } from "../../outbound/project/settings/settings.js";
import { startFirstIngest } from "./start-first-ingest.js";

const REPO = "re-cinq/app";

class RefusingSettings extends InMemorySettings {
  constructor(
    private readonly refusal: "enable" | "dispatch",
    private readonly file: string,
    private readonly message: string,
  ) {
    super();
  }

  override async enableWorkflow(repo: string, file: string): Promise<void> {
    enforceTrue(
      !(this.refusal === "enable" && file === this.file),
      Error,
      this.message,
    );
    await super.enableWorkflow(repo, file);
  }

  override async dispatchWorkflow(
    repo: string,
    file: string,
    ref: string,
  ): Promise<void> {
    enforceTrue(
      !(this.refusal === "dispatch" && file === this.file),
      Error,
      this.message,
    );
    await super.dispatchWorkflow(repo, file, ref);
  }
}

function activeBoth(port: InMemorySettings): void {
  port.workflowStates.set(`${REPO}/lore-ingest.yml`, "active");
  port.workflowStates.set(`${REPO}/lore-tests.yml`, "active");
}

describe("startFirstIngest", () => {
  it("dispatches lore-ingest.yml then lore-tests.yml on main when both are active", async () => {
    const port = new InMemorySettings();

    activeBoth(port);

    expect(await startFirstIngest(new Settings(REPO, port), "main")).toEqual({
      started: ["lore-ingest.yml", "lore-tests.yml"],
      gaps: [],
    });
    expect(port.dispatchedWorkflows).toEqual([
      { repo: REPO, file: "lore-ingest.yml", ref: "main" },
      { repo: REPO, file: "lore-tests.yml", ref: "main" },
    ]);
  });

  it("enables lore-ingest.yml before dispatching it when it is disabled", async () => {
    const port = new InMemorySettings();

    activeBoth(port);
    port.workflowStates.set(`${REPO}/lore-ingest.yml`, "disabled");

    await startFirstIngest(new Settings(REPO, port), "main");

    expect(port.enabledWorkflows).toEqual([
      { repo: REPO, file: "lore-ingest.yml" },
    ]);
    expect(port.dispatchedWorkflows[0]).toEqual({
      repo: REPO,
      file: "lore-ingest.yml",
      ref: "main",
    });
  });

  it("records a gap for lore-tests.yml and dispatches only lore-ingest.yml when lore-tests.yml is missing", async () => {
    const port = new InMemorySettings();

    port.workflowStates.set(`${REPO}/lore-ingest.yml`, "active");

    expect(await startFirstIngest(new Settings(REPO, port), "main")).toEqual({
      started: ["lore-ingest.yml"],
      gaps: [
        {
          step: "lore-tests.yml",
          error: "the workflow is not on the default branch",
        },
      ],
    });
    expect(port.dispatchedWorkflows).toEqual([
      { repo: REPO, file: "lore-ingest.yml", ref: "main" },
    ]);
  });

  it("records GitHub's 403 as a gap and still dispatches lore-tests.yml when enabling lore-ingest.yml is refused", async () => {
    const port = new RefusingSettings(
      "enable",
      "lore-ingest.yml",
      "Resource not accessible by integration",
    );

    port.workflowStates.set(`${REPO}/lore-ingest.yml`, "disabled");
    port.workflowStates.set(`${REPO}/lore-tests.yml`, "active");

    expect(await startFirstIngest(new Settings(REPO, port), "main")).toEqual({
      started: ["lore-tests.yml"],
      gaps: [
        {
          step: "lore-ingest.yml",
          error: "Resource not accessible by integration",
        },
      ],
    });
    expect(port.dispatchedWorkflows).toEqual([
      { repo: REPO, file: "lore-tests.yml", ref: "main" },
    ]);
  });

  it("records GitHub's 422 as a gap when dispatching lore-tests.yml is refused", async () => {
    const port = new RefusingSettings(
      "dispatch",
      "lore-tests.yml",
      "Workflow does not have 'workflow_dispatch' trigger",
    );

    activeBoth(port);

    expect(await startFirstIngest(new Settings(REPO, port), "main")).toEqual({
      started: ["lore-ingest.yml"],
      gaps: [
        {
          step: "lore-tests.yml",
          error: "Workflow does not have 'workflow_dispatch' trigger",
        },
      ],
    });
  });
});
