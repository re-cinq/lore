import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";

vi.mock("../lib/audit.js", () => ({ writeAuditLog: vi.fn(async () => {}) }));

import { evaluateAndMerge, type AutoMergeJobInputs } from "./auto-merge.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => provider.register());
afterAll(async () => provider.shutdown());
beforeEach(() => exporter.reset());

function jobInputsDeferredDarkModeOff(): AutoMergeJobInputs {
  return {
    taskId: "task-123",
    repo: "re-cinq/lore",
    prNumber: 42,
    policy: {
      darkFactoryEnabled: false,
      autoMerge: {
        paths: ["specs/**", "*.md"],
        min_trust: "docs",
        require_green_ci: true,
        require_bot_approval: true,
      },
      trustLevel: "docs",
      changedPaths: ["specs/foo.md"],
      ciSucceeded: true,
      botApproved: true,
      humanChangesRequested: false,
      reviewInFlight: false,
    },
  };
}

describe("lore.auto_merge.decision OTEL span", () => {
  it("emits exactly one span named lore.auto_merge.decision per decision", async () => {
    await evaluateAndMerge(jobInputsDeferredDarkModeOff());

    const decisionSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "lore.auto_merge.decision");

    expect(decisionSpans).toHaveLength(1);
  });

  it("carries the decision rule trace as span attributes", async () => {
    await evaluateAndMerge(jobInputsDeferredDarkModeOff());

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "lore.auto_merge.decision");

    expect(span?.attributes).toMatchObject({
      repo: "re-cinq/lore",
      pr_number: 42,
      task_id: "task-123",
      decision: "deferred:dark_mode_off",
      path_match_count: 1,
      trust_level: "docs",
      ci_status: "success",
      bot_review_state: "APPROVED",
    });
  });
});
