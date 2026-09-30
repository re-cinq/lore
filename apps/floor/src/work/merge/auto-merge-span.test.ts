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

vi.mock("../../outbound/audit.js", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

import { evaluateAndMerge, type AutoMergeJobInputs } from "./auto-merge.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => provider.register());
afterAll(async () => provider.shutdown());
beforeEach(() => exporter.reset());

function jobInputsDeferredAutoMergeOff(): AutoMergeJobInputs {
  return {
    taskId: "task-123",
    repo: "re-cinq/lore",
    prNumber: 42,
    policy: {
      autoMerge: {
        enabled: false,
        paths: ["specs/**", "*.md"],
        escalate_paths: [],
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
    await evaluateAndMerge(jobInputsDeferredAutoMergeOff());

    const decisionSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "lore.auto_merge.decision");

    expect(decisionSpans).toHaveLength(1);
  });

  it("carries the decision rule trace as span attributes", async () => {
    await evaluateAndMerge(jobInputsDeferredAutoMergeOff());

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "lore.auto_merge.decision");

    expect(span?.attributes).toMatchObject({
      repo: "re-cinq/lore",
      pr_number: 42,
      task_id: "task-123",
      decision: "deferred:auto_merge_off",
      path_match_count: 1,
      escalated_path_count: 0,
      trust_level: "docs",
      ci_status: "success",
      bot_review_state: "APPROVED",
    });
  });
});
