import { readdirSync, readFileSync } from "node:fs";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";

interface Arg {
  kind: string;
  subject?: boolean;
}

interface Edge {
  from: string;
  to: string;
  on: string;
  iteration_max?: number;
}

interface Need {
  name: string;
  kind: string;
  path?: string;
  access?: string;
  optional?: boolean;
}

interface Station {
  kind: string;
  outcomes: string[];
  needs: Need[];
}

interface AgentSettings {
  model: string;
  prompt: string;
  config: {
    env: Record<string, string>;
    pod_resources: {
      requests: Record<string, string>;
      limits: Record<string, string>;
    };
  };
}

interface Pipeline {
  line: {
    id: string;
    entry: string;
    exit: string;
    start?: { on: string[] };
    files?: Record<string, string>;
    args: Record<string, Arg>;
    nodes: { id: string; station?: string }[];
    edges: Edge[];
  };
  stations: Record<string, Station>;
  agent_definitions?: Record<string, { settings: AgentSettings }>;
}

const PIPELINES = loadPipelines();

describe("the floor pipelines shipped in this folder", () => {
  it("ships exactly the pipelines code-review, code-review-recheck, code-review-reply, feature-planning, lore-run-settled and merge", () => {
    expect(
      [...PIPELINES.values()].map((pipeline) => pipeline.line.id).sort(),
    ).toEqual([
      "code-review",
      "code-review-recheck",
      "code-review-reply",
      "feature-planning",
      "lore-run-settled",
      "merge",
    ]);
  });

  it("walks merge from settle through spec-status, close-issue, outcome-stats, curate, memory-feedback, trust and spec-tasks to done", () => {
    const { line } = pipelineOf("merge");

    expect(line.nodes).toEqual([
      { id: "settle", station: "merge-settle" },
      { id: "spec-status", station: "merge-spec-status" },
      { id: "close-issue", station: "merge-close-issue" },
      { id: "outcome-stats", station: "merge-outcome-stats" },
      { id: "curate", station: "merge-curate" },
      { id: "memory-feedback", station: "merge-memory-feedback" },
      { id: "trust", station: "merge-trust" },
      { id: "spec-tasks", station: "merge-spec-tasks" },
      { id: "done" },
    ]);
  });

  it("walks merge on from every step after settle whatever its outcome, and retries a failed settle once so a second failure settles the run as iteration_max", () => {
    const { line } = pipelineOf("merge");

    expect(line.edges).toEqual([
      { from: "settle", to: "spec-status", on: "success" },
      { from: "settle", to: "settle", on: "failed", iteration_max: 1 },
      { from: "spec-status", to: "close-issue", on: "always" },
      { from: "close-issue", to: "outcome-stats", on: "always" },
      { from: "outcome-stats", to: "curate", on: "always" },
      { from: "curate", to: "memory-feedback", on: "always" },
      { from: "memory-feedback", to: "trust", on: "always" },
      { from: "trust", to: "spec-tasks", on: "always" },
      { from: "spec-tasks", to: "done", on: "always" },
    ]);
  });

  it("keys a merge run on its task_id and hands every merge station that one value", () => {
    const { line, stations } = pipelineOf("merge");

    expect(line.args).toEqual({ task_id: { kind: "value", subject: true } });
    expect(Object.values(stations)).toEqual(
      Array.from({ length: 8 }, () => ({
        kind: "service",
        outcomes: ["success", "failed"],
        needs: [{ name: "task_id", kind: "value" }],
        produces: [],
      })),
    );
  });

  it("walks code-review from review through post-review to done, with no refine node", () => {
    const { line } = pipelineOf("code-review");

    expect({
      entry: line.entry,
      exit: line.exit,
      reviewTargets: edgesOn(line, "review")
        .filter((edge) => edge.to !== "review")
        .map((edge) => `${edge.on}->${edge.to}`)
        .sort(),
      nodes: line.nodes.map((node) => node.id),
    }).toEqual({
      entry: "review",
      exit: "done",
      reviewTargets: ["changes_requested->post-review", "success->post-review"],
      nodes: ["review", "post-review", "done"],
    });
  });

  it("retries a failed code-review review visit once through an iteration_max of 1", () => {
    expect(
      edgesOn(pipelineOf("code-review").line, "review").filter(
        (edge) => edge.to === "review",
      ),
    ).toEqual([
      { from: "review", to: "review", on: "failed", iteration_max: 1 },
    ]);
  });

  it("retries a failed code-review-recheck recheck visit once through an iteration_max of 1", () => {
    expect(
      edgesOn(pipelineOf("code-review-recheck").line, "recheck").filter(
        (edge) => edge.to === "recheck",
      ),
    ).toEqual([
      { from: "recheck", to: "recheck", on: "failed", iteration_max: 1 },
    ]);
  });

  it("walks code-review-recheck through recheck, post-review and done on gemini-3.1-pro-preview with edges for changes_requested, failed and success", () => {
    const { line, agent_definitions } = pipelineOf("code-review-recheck");

    expect({
      nodes: line.nodes.map((node) => node.id),
      model: agent_definitions?.["code-review-recheck"]?.settings.model,
      recheckOutcomes: edgesOn(line, "recheck")
        .map((edge) => edge.on)
        .sort(),
    }).toEqual({
      nodes: ["recheck", "post-review", "done"],
      model: "gemini-3.1-pro-preview",
      recheckOutcomes: ["changes_requested", "failed", "success"],
    });
  });

  it("marks pr_url as the subject of code-review and head_sha as the subject of code-review-recheck, so a re-check never joins an open review and two re-checks of one sha are one run", () => {
    const subjectArgs = (id: string): string[] =>
      Object.entries(pipelineOf(id).line.args)
        .filter(([, arg]) => arg.subject)
        .map(([name]) => name);

    expect({
      review: subjectArgs("code-review"),
      recheck: subjectArgs("code-review-recheck"),
      reply: subjectArgs("code-review-reply"),
    }).toEqual({ review: ["pr_url"], recheck: ["head_sha"], reply: [] });
  });

  it("enters code-review-reply at read-review and clones the repository with write access for its code-review-refine station", () => {
    const { line, stations } = pipelineOf("code-review-reply");

    expect({
      entry: line.entry,
      target: needOf(stations["code-review-refine"], "target"),
    }).toMatchObject({
      entry: "read-review",
      target: { kind: "git", access: "write" },
    });
  });

  it("declares the optional file need issue at issue.md on every review agent station", () => {
    const stations = [
      pipelineOf("code-review").stations["code-review"],
      pipelineOf("code-review-recheck").stations["code-review-recheck"],
      pipelineOf("code-review-reply").stations["code-review-refine"],
    ];

    expect(stations.map((station) => needOf(station, "issue"))).toEqual(
      stations.map(() => ({
        name: "issue",
        kind: "file",
        path: "issue.md",
        optional: true,
      })),
    );
  });

  it("takes head_sha as an optional need on post-review", () => {
    expect(
      needOf(pipelineOf("code-review").stations["post-review"], "head_sha"),
    ).toEqual({ name: "head_sha", kind: "value", optional: true });
  });

  it("starts lore-run-settled on internal.run.settled", () => {
    expect(pipelineOf("lore-run-settled").line.start?.on).toEqual([
      "internal.run.settled",
    ]);
  });
});

describe("the feature-planning pipeline", () => {
  it("walks feature-planning from analyze through author's waits to done, with validate entered only by its own start event", () => {
    const { line } = pipelineOf("feature-planning");

    expect({
      entry: line.entry,
      exit: line.exit,
      nodes: line.nodes.map((node) => node.id).sort(),
      validateStart: line.nodes.find((node) => node.id === "validate")?.station,
    }).toEqual({
      entry: "analyze",
      exit: "done",
      nodes: [
        "analyse-specs",
        "analyze",
        "author",
        "decompose",
        "done",
        "issues",
        "merged",
        "open-spec-pr",
        "plan-pass-end",
        "validate",
        "write",
      ].sort(),
      validateStart: "plan-validate",
    });
  });

  it("marks plan_id as the only subject of feature-planning", () => {
    const subjectArgs = Object.entries(pipelineOf("feature-planning").line.args)
      .filter(([, arg]) => arg.subject)
      .map(([name]) => name);

    expect(subjectArgs).toEqual(["plan_id"]);
  });

  it("gives spec-write git write access to target, guarded by the author node on every path in, and tells it to push its own commit", () => {
    const { stations } = pipelineOf("feature-planning");

    expect({
      target: needOf(stations["spec-write"], "target"),
      pushes: promptOnOneLine("spec-write").includes(
        "git -C /workspace/target push origin HEAD",
      ),
    }).toEqual({
      target: { name: "target", kind: "git", path: "target", access: "write" },
      pushes: true,
    });
  });

  it("has the validation read the live plan through lore_plan_read rather than a plan.md snapshot", () => {
    const { stations } = pipelineOf("feature-planning");

    expect({
      planId: needOf(stations["plan-validate"], "plan_id")?.kind,
      snapshot: needOf(stations["plan-validate"], "plan_md"),
      readsLive: promptOnOneLine("plan-validate").includes(
        "lore_plan_read {plan_id}",
      ),
    }).toEqual({ planId: "value", snapshot: undefined, readsLive: true });
  });

  it("tells every feature-planning agent to pass repo on every lore call", () => {
    const agents = [
      "plan-analyze",
      "plan-validate",
      "spec-analysis",
      "spec-write",
      "feature-decompose",
    ];

    expect(
      agents.map((agent) =>
        promptOnOneLine(agent).includes(
          "Pass the `repo` named on the description's first line on every `lore_*` call",
        ),
      ),
    ).toEqual(agents.map(() => true));
  });
});

describe("the code-review recipe reads the change as its user first", () => {
  it("asks, for every spec statement the PR adds or changes, what a person using that surface sees differently, and files a mismatch as a question rather than silence", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      asUser: prompt.includes("what a person using that surface"),
      neighbours: prompt.includes("the statements beside it"),
      question: prompt.includes("label it `question`"),
    }).toEqual({ asUser: true, neighbours: true, question: true });
  });

  it("names lint, types, formatting and tests as CI's verdict, read through lore_get_ci_failures, so the review spends no commands reproducing them", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      ciJudges: prompt.includes("CI's verdict"),
      tool: prompt.includes("`lore_get_ci_failures`"),
      noEslint: prompt.includes("not eslint, tsc or a formatter"),
    }).toEqual({ ciJudges: true, tool: true, noEslint: true });
  });

  it("reads the diff once in place and never dumps it to a file to re-read", () => {
    expect(promptOnOneLine("code-review")).toContain(
      "Read the diff once, in place",
    );
  });

  it("queries context with the PR's subject, spec and surface, never with a description of reviewing", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      subject: prompt.includes("the PR title, the spec sections it touches"),
      reviewingQueryRuledOut: prompt.includes('not "PR review conventions"'),
    }).toEqual({ subject: true, reviewingQueryRuledOut: true });
  });

  it("reserves changes_requested for a defect in the changed code or a mismatch between the spec and what a person would expect, and says a question alone does not block", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      mismatch: prompt.includes(
        "a mismatch between what the spec says and what a person would expect",
      ),
      questionNoBlock: prompt.includes("A `question` alone never blocks"),
    }).toEqual({ mismatch: true, questionNoBlock: true });
  });
});

describe("the code-review-recheck recipe judges the push, not the pull request", () => {
  it("reads the range since the sha the last verdict judged, rather than the whole PR again", () => {
    const prompt = promptOnOneLine("code-review-recheck");

    expect({
      named: prompt.includes("names the sha the last verdict judged"),
      range: prompt.includes("..HEAD` and judge that range"),
      whole: prompt.includes("When no sha is named, read `main...HEAD`"),
    }).toEqual({ named: true, range: true, whole: true });
  });

  it("carries the same CI-verdict and read-once rules as the deep review, so a re-check runs no linter either", () => {
    const prompt = promptOnOneLine("code-review-recheck");

    expect({
      ci: prompt.includes("CI's verdict"),
      tool: prompt.includes("`lore_get_ci_failures`"),
      noEslint: prompt.includes("not eslint, tsc or a formatter"),
      once: prompt.includes("Read each diff once, in place"),
    }).toEqual({ ci: true, tool: true, noEslint: true, once: true });
  });

  it("queries context with the PR title and the surface the new commits change", () => {
    expect(promptOnOneLine("code-review-recheck")).toContain(
      "the PR title and the surface these commits change",
    );
  });
});

describe("test_policy on the review agent definitions", () => {
  it("declares LORE_TEST_POLICY none on code-review, code-review-recheck and code-review-refine, so a review pod cannot run tests, installs or builds at all", () => {
    const names = ["code-review", "code-review-recheck", "code-review-refine"];

    expect(
      names.map((name) => settingsOf(name).config.env.LORE_TEST_POLICY),
    ).toEqual(["none", "none", "none"]);
  });
});

describe("the review definitions' findings block", () => {
  it("shows a whole finding with path, line, label, decoration and subject in code-review and code-review-recheck, so no model guesses the shape (#2143's recheck lost every finding)", () => {
    const shapes = ["code-review", "code-review-recheck"].map((name) => {
      const prompt = settingsOf(name).prompt;

      return ['"path"', '"line"', '"label"', '"decoration"', '"subject"'].every(
        (field) => prompt.includes(field),
      );
    });

    expect(shapes).toEqual([true, true]);
  });
});

describe("what a review pod is given against the agent CLI's own limits", () => {
  const REVIEW_AGENTS = [
    ["code-review", "code-review"],
    ["code-review-recheck", "code-review-recheck"],
    ["code-review-reply", "code-review-refine"],
  ] as const;

  it("ships no experiments file and sets no GEMINI_EXP of its own, since the agent runtime sets the timeout since ai-agent-subsystem v0.11.8", () => {
    const shipped = REVIEW_AGENTS.map(([line, agent]) => ({
      file: pipelineOf(line).line.files?.gemini_exp,
      need: needOf(pipelineOf(line).stations[agent], "gemini_exp"),
      env: settingsOf(agent).config.env.GEMINI_EXP,
    }));

    expect(shipped).toEqual(
      REVIEW_AGENTS.map(() => ({
        file: undefined,
        need: undefined,
        env: undefined,
      })),
    );
  });

  it("reads every diff with --no-ext-diff, since the agent's shell sets an empty external diff", () => {
    expect({
      review: promptOnOneLine("code-review").includes(
        "git -C /workspace/target diff --no-ext-diff main...HEAD",
      ),
      recheck: promptOnOneLine("code-review-recheck").includes(
        "git -C /workspace/target diff --no-ext-diff <that sha>..HEAD",
      ),
    }).toEqual({ review: true, recheck: true });
  });

  it("tells the review and the re-check to pass repo on every lore call", () => {
    const told = ["code-review", "code-review-recheck"].map((agent) =>
      promptOnOneLine(agent).includes(
        "Pass the `repo` named on the description's first line on every `lore_*` call",
      ),
    );

    expect(told).toEqual([true, true]);
  });

  it("tells every review agent not to look for an issue file it was not given", () => {
    const told = REVIEW_AGENTS.map(([, agent]) =>
      promptOnOneLine(agent).includes(
        "When the file is not there, the pull request names no issue: do not look for one.",
      ),
    );

    expect(told).toEqual([true, true, true]);
  });

  it("keeps every review agent's pod at 500m CPU and 512Mi requested and 2Gi of memory at most, and raises its disk to 2Gi requested and 4Gi at most", () => {
    const sizes = REVIEW_AGENTS.map(
      ([, agent]) => settingsOf(agent).config.pod_resources,
    );
    const size = {
      requests: { cpu: "500m", memory: "512Mi", "ephemeral-storage": "2Gi" },
      limits: { memory: "2Gi", "ephemeral-storage": "4Gi" },
    };

    expect(sizes).toEqual([size, size, size]);
  });

  it("sends no failed outcome of a review line to the exit, where the run would settle as success", () => {
    const failedToExit = [
      "code-review",
      "code-review-recheck",
      "code-review-reply",
    ]
      .map((id) => pipelineOf(id).line)
      .flatMap((line) =>
        line.edges.filter(
          (edge) => edge.on === "failed" && edge.to === line.exit,
        ),
      );

    expect(failedToExit).toEqual([]);
  });

  it("gives every outcome a station declares an edge out of its node, in every pipeline", () => {
    const missing = [...PIPELINES.values()].flatMap(outcomesWithoutEdge);

    expect(missing).toEqual([]);
  });

  it("sends a failed post-review or post-reply back to its agent once, and retries a failed read-review and reply visit once, so a second failure settles the run as iteration_max and not as success", () => {
    const retries = [
      ["code-review", "post-review"],
      ["code-review-recheck", "post-review"],
      ["code-review-reply", "read-review"],
      ["code-review-reply", "reply"],
      ["code-review-reply", "post-reply"],
    ].map(([line, node]) =>
      edgesOn(pipelineOf(line).line, node).find((edge) => edge.on === "failed"),
    );

    expect(retries).toEqual([
      {
        from: "post-review",
        to: "review",
        on: "failed",
        iteration_max: 1,
      },
      {
        from: "post-review",
        to: "recheck",
        on: "failed",
        iteration_max: 1,
      },
      {
        from: "read-review",
        to: "read-review",
        on: "failed",
        iteration_max: 1,
      },
      { from: "reply", to: "reply", on: "failed", iteration_max: 1 },
      { from: "post-reply", to: "reply", on: "failed", iteration_max: 1 },
    ]);
  });
});

function outcomesWithoutEdge({ line, stations }: Pipeline): string[] {
  return line.nodes.flatMap((node) => {
    const out = edgesOn(line, node.id);

    if (out.some((edge) => edge.on === "always")) {
      return [];
    }
    const covered = out.map((edge) => edge.on);
    const declared = stations[node.station ?? ""]?.outcomes ?? [];

    return declared
      .filter((outcome) => !covered.includes(outcome))
      .map((outcome) => `${line.id}: ${node.id} has no edge for ${outcome}`);
  });
}

function loadPipelines(): Map<string, Pipeline> {
  const folder = new URL("./", import.meta.url);
  const pipelines = readdirSync(folder)
    .filter((file) => file.endsWith(".yaml"))
    .map(
      (file) => parse(readFileSync(new URL(file, folder), "utf8")) as Pipeline,
    );

  return new Map(pipelines.map((pipeline) => [pipeline.line.id, pipeline]));
}

function pipelineOf(id: string): Pipeline {
  const pipeline = PIPELINES.get(id);

  enforceTrue(pipeline !== undefined, Error, `no floor pipeline ${id}`);

  return pipeline;
}

function edgesOn(line: Pipeline["line"], from: string): Edge[] {
  return line.edges.filter((edge) => edge.from === from);
}

function needOf(station: Station | undefined, name: string): Need | undefined {
  return station?.needs.find((need) => need.name === name);
}

function settingsOf(name: string): AgentSettings {
  const definition = [...PIPELINES.values()]
    .map((pipeline) => pipeline.agent_definitions?.[name])
    .find((candidate) => candidate !== undefined);

  enforceTrue(definition !== undefined, Error, `no agent definition ${name}`);

  return definition.settings;
}

function promptOnOneLine(name: string): string {
  return settingsOf(name).prompt.replace(/\s+/g, " ");
}
