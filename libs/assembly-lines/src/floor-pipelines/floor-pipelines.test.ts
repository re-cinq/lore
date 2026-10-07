import { readdirSync, readFileSync } from "node:fs";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { withAgentPrompts } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import { COVERAGE_ROUNDS } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";

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
  agent_definition?: string;
  outcomes: string[];
  needs: Need[];
  produces: Array<{ name: string; kind: string; path?: string }>;
}

interface AgentSettings {
  model: string;
  prices?: Record<
    string,
    { input_per_million: number; output_per_million: number }
  >;
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
    nodes: { id: string; station?: string; bind?: Record<string, string> }[];
    edges: Edge[];
  };
  stations: Record<string, Station>;
  agent_definitions?: Record<string, { settings: AgentSettings }>;
}

const PIPELINES = loadPipelines();

const REPAIRS = ["repair-build", "fix-ci"];

const LOOP_WAIT = {
  kind: "human",
  produces: [
    { name: "ci_feedback_sha", kind: "value" },
    { name: "ci_failed_checks", kind: "value" },
    { name: "ci_failure_summary", kind: "value" },
    { name: "round_brief", kind: "file" },
  ],
};

const ROUND_BRIEF = {
  name: "round_brief",
  kind: "file",
  path: "round-brief.md",
  optional: true,
};

const ONBOARD_AGENT_NEEDS = [
  { name: "target", kind: "git", path: "target", access: "write" },
  { name: "ticket", kind: "file", path: "ticket.md" },
];

describe("the floor pipelines shipped in this folder", () => {
  it("ships exactly the pipelines code-review, code-review-recheck, code-review-reply, daily-digest, feature-planning, implementation-loop, issue-triage, lore-run-settled, merge, onboard and spec-upkeep", () => {
    expect(
      [...PIPELINES.values()].map((pipeline) => pipeline.line.id).sort(),
    ).toEqual([
      "code-review",
      "code-review-recheck",
      "code-review-reply",
      "daily-digest",
      "feature-planning",
      "implementation-loop",
      "issue-triage",
      "lore-run-settled",
      "merge",
      "onboard",
      "spec-upkeep",
    ]);
  });

  it("walks implementation-loop from dod through open-pr, tdd-round, await-ci, ready-for-review, mark-ready and await-pr to done", () => {
    const { line } = pipelineOf("implementation-loop");
    const forward = line.edges
      .filter((edge) => edge.on === "success" && !REPAIRS.includes(edge.from))
      .map((edge) => `${edge.from}>${edge.to}`);

    expect(line.entry).toBe("dod");
    expect(forward).toEqual([
      "dod>open-pr",
      "open-pr>tdd-round",
      "tdd-round>await-ci",
      "await-ci>ready-for-review",
      "ready-for-review>mark-ready",
      "mark-ready>await-pr",
      "await-pr>done",
    ]);
  });

  it("gives the loop twelve rounds and two repairs on a red await-ci, and three fix-ci visits on a red await-pr", () => {
    const { line } = pipelineOf("implementation-loop");
    const budgets = line.edges
      .filter((edge) => ["await-ci", "await-pr"].includes(edge.from))
      .filter((edge) => edge.iteration_max !== undefined)
      .map(
        (edge) =>
          `${edge.from}>${edge.to} on ${edge.on}: ${edge.iteration_max}`,
      );

    expect(budgets).toEqual([
      "await-ci>tdd-round on changes_requested: 12",
      "await-ci>repair-build on failed: 2",
      "await-pr>fix-ci on changes_requested: 3",
    ]);
  });

  it("sends every verdict of repair-build back to await-ci and of fix-ci back to await-pr, so the build judges the repair", () => {
    const { line } = pipelineOf("implementation-loop");
    const back = REPAIRS.flatMap((repair) => edgesOn(line, repair))
      .filter((edge) => edge.on !== "failed")
      .map((edge) => `${edge.from}>${edge.to} on ${edge.on}`);

    expect(back).toEqual([
      "repair-build>await-ci on success",
      "repair-build>await-ci on changes_requested",
      "fix-ci>await-pr on success",
      "fix-ci>await-pr on changes_requested",
    ]);
  });

  it("ends a loop run at done on a dod scoping verdict and on await-pr's unresolved threads, and retries every other failed station once", () => {
    const { line } = pipelineOf("implementation-loop");
    const toExit = line.edges
      .filter((edge) => edge.to === "done" && edge.on !== "success")
      .map((edge) => `${edge.from} on ${edge.on}`);
    const retried = line.edges
      .filter((edge) => edge.on === "failed" && edge.from === edge.to)
      .map((edge) => `${edge.from}:${edge.iteration_max}`);

    expect(toExit).toEqual(["dod on changes_requested", "await-pr on failed"]);
    expect(retried).toEqual([
      "dod:1",
      "open-pr:1",
      "tdd-round:1",
      "repair-build:1",
      "ready-for-review:1",
      "mark-ready:1",
      "fix-ci:1",
    ]);
  });

  it("keys a loop run on backlog, so a repository works one ticket at a time, and takes the task and the ticket beside it", () => {
    const { line } = pipelineOf("implementation-loop");

    expect(subjectsOf(line)).toEqual(["backlog"]);
    expect(Object.keys(line.args)).toEqual([
      "repo",
      "backlog",
      "task_id",
      "ticket",
    ]);
  });

  it("has open-spec-pr read the spec plan and produce spec_path as a value beside pr_url, which issues takes as an optional value instead of the spec plan", () => {
    const { stations } = pipelineOf("feature-planning");
    const openSpecPr = stations["open-spec-pr"];
    const issues = stations["issues"];

    expect({
      openSpecPrReads: needOf(openSpecPr, "spec_plan")?.kind,
      openSpecPrProduces: openSpecPr.produces,
      issuesReads: needOf(issues, "spec_path"),
      issuesReadsPlan: needOf(issues, "spec_plan"),
    }).toEqual({
      openSpecPrReads: "file",
      openSpecPrProduces: [
        { name: "pr_url", kind: "value" },
        { name: "spec_path", kind: "value" },
        { name: "issue_coverage", kind: "file" },
      ],
      issuesReads: { name: "spec_path", kind: "value", optional: true },
      issuesReadsPlan: undefined,
    });
  });

  it("makes both loop waits human stations that produce the three CI values and the round brief as a file", () => {
    const { stations } = pipelineOf("implementation-loop");
    const waits = ["loop-await-ci", "loop-await-pr"].map((name) => ({
      kind: stations[name].kind,
      produces: stations[name].produces,
    }));

    expect(waits).toEqual([LOOP_WAIT, LOOP_WAIT]);
  });

  it("hands tdd-round, repair-build and fix-ci the round brief as the optional file round-brief.md", () => {
    const { stations } = pipelineOf("implementation-loop");
    const briefs = ["loop-tdd-round", "loop-repair-build", "loop-fix-ci"].map(
      (name) => needOf(stations[name], "round_brief"),
    );

    expect(briefs).toEqual([ROUND_BRIEF, ROUND_BRIEF, ROUND_BRIEF]);
  });

  it("has ready-for-review produce the description as pr-body.md with a title and coverage, each an optional need of mark-ready", () => {
    const { stations } = pipelineOf("implementation-loop");
    const produced = stations["loop-ready-for-review"].produces.map(
      (made) => made.name,
    );
    const optional = stations["loop-mark-ready"].needs
      .filter((need) => need.optional)
      .map((need) => need.name);

    expect(produced).toEqual([
      "pr_body",
      "pr_title",
      "issue_coverage",
      "pr_blocked",
    ]);
    expect(optional).toEqual([
      "issue_number",
      "pr_body",
      "pr_title",
      "issue_coverage",
    ]);
  });

  it("tells every loop agent the ticket's path and to work inside /workspace/target, and names no value an agent's extras cannot produce", () => {
    const { stations, agent_definitions: agents } = pipelineOf(
      "implementation-loop",
    );
    const prompts = Object.values(agents!).map(
      (agent) => agent.settings.prompt,
    );
    const reported = prompts.flatMap((prompt) =>
      [...prompt.matchAll(/"extras":\{"([a-z_]+)"/g)].map((match) => match[1]),
    );
    const declared = Object.values(stations).flatMap((station) =>
      station.produces.map((made) => made.name),
    );

    expect(prompts.every((prompt) => prompt.includes("{ticket_path}"))).toBe(
      true,
    );
    expect(
      prompts.every((prompt) => prompt.includes("cd /workspace/target")),
    ).toBe(true);
    expect(reported.filter((name) => !declared.includes(name))).toEqual([
      "pr_ready",
    ]);
  });

  it("tells the round and the repair to read /workspace/round-brief.md for CI's verdict, and the ready agent to write the description at its produced path", () => {
    const prompt = (agent: string) =>
      pipelineOf("implementation-loop").agent_definitions![agent].settings
        .prompt;

    expect(prompt("loop-tdd-round")).toContain("/workspace/round-brief.md");
    expect(prompt("loop-fix-ci")).toContain("/workspace/round-brief.md");
    expect(prompt("loop-pr-ready")).toContain("WRITE `{pr_body_path}`");
  });

  it("walks spec-upkeep from detect-drift through detect-unlinked, update-specs, open-pr, await-ci and request-review to done", () => {
    const { line } = pipelineOf("spec-upkeep");
    const forward = line.edges
      .filter((edge) => edge.on === "success" && edge.from !== "fix-ci")
      .map((edge) => `${edge.from}>${edge.to}`);

    expect(line.entry).toBe("detect-drift");
    expect(forward).toEqual([
      "detect-drift>detect-unlinked",
      "detect-unlinked>update-specs",
      "update-specs>open-pr",
      "open-pr>await-ci",
      "await-ci>request-review",
      "request-review>done",
    ]);
  });

  it("ends a spec-upkeep run at done, before any agent, when the detectors found nothing, and after one when it left no commit", () => {
    const nothing = pipelineOf("spec-upkeep").line.edges.filter(
      (edge) => edge.on === "nothing",
    );

    expect(nothing).toEqual([
      { from: "detect-unlinked", to: "done", on: "nothing" },
      { from: "open-pr", to: "done", on: "nothing" },
    ]);
  });

  it("keys a spec-upkeep run on its day, and hands the agent the two briefs as drift.md and unlinked.md with write access to the branch", () => {
    const { line, stations } = pipelineOf("spec-upkeep");

    expect(subjectsOf(line)).toEqual(["upkeep"]);
    expect(stations["spec-upkeep-update-specs"].needs).toEqual([
      { name: "target", kind: "git", path: "target", access: "write" },
      { name: "drift", kind: "file", path: "drift.md" },
      { name: "unlinked", kind: "file", path: "unlinked.md" },
    ]);
  });

  it("sends a red spec-upkeep build to fix-ci twice at most, retries every failed station once and sends no failed outcome to the exit", () => {
    const { line } = pipelineOf("spec-upkeep");
    const failed = line.edges
      .filter((edge) => edge.on === "failed")
      .map((edge) => `${edge.from}>${edge.to}:${edge.iteration_max}`);

    expect(failed).toEqual([
      "detect-drift>detect-drift:1",
      "detect-unlinked>detect-unlinked:1",
      "update-specs>update-specs:1",
      "open-pr>open-pr:1",
      "await-ci>fix-ci:2",
      "fix-ci>fix-ci:1",
      "request-review>request-review:1",
    ]);
  });

  it("tells the upkeep agent to change specification files only, to commit drift and links separately, and where its briefs and its description are", () => {
    const { prompt } =
      pipelineOf("spec-upkeep").agent_definitions!["spec-upkeep-update-specs"]
        .settings;
    const told = [
      "NEVER change code, tests, build files or workflows",
      "spec: update statements that drifted from the code",
      "spec: link statements to the tests that validate them",
      "{drift_path}",
      "{unlinked_path}",
      "{pr_body_path}",
    ].filter((phrase) => prompt.includes(phrase));

    expect(told).toHaveLength(6);
  });

  it("tells the upkeep repair it cannot run tests, linters or builds, to read CI's verdict, and to leave a failure that is not a spec's alone", () => {
    const { prompt } =
      pipelineOf("spec-upkeep").agent_definitions!["spec-upkeep-fix-ci"]
        .settings;
    const told = [
      "YOU CANNOT RUN TESTS, LINTERS, TYPECHECKS, BUILDS OR INSTALLS HERE",
      "/workspace/round-brief.md",
      "NEVER change code, tests, build files or workflows",
    ].filter((phrase) => prompt.includes(phrase));

    expect(told).toHaveLength(3);
    expect(prompt).not.toMatch(/npm run|vitest|run only that step/);
  });

  it("lets neither upkeep agent run tests, installs or builds", () => {
    const policies = ["spec-upkeep-update-specs", "spec-upkeep-fix-ci"].map(
      (agent) =>
        pipelineOf("spec-upkeep").agent_definitions![agent].settings.config.env
          .LORE_TEST_POLICY,
    );

    expect(policies).toEqual(["none", "none"]);
  });

  it("walks onboard from enrol through author, open-pr, await-ci and request-review to done", () => {
    const { line } = pipelineOf("onboard");
    const forward = line.edges
      .filter((edge) => edge.on === "success" && edge.from !== "fix-ci")
      .map((edge) => `${edge.from}>${edge.to}`);

    expect(line.entry).toBe("enrol");
    expect(forward).toEqual([
      "enrol>author",
      "author>open-pr",
      "open-pr>await-ci",
      "await-ci>request-review",
      "request-review>done",
    ]);
  });

  it("sends a red onboard build to fix-ci twice at most and every fix-ci verdict back to the await-ci wait", () => {
    const { line } = pipelineOf("onboard");

    expect(
      edgesOn(line, "await-ci").filter((edge) => edge.to === "fix-ci"),
    ).toEqual([
      {
        from: "await-ci",
        to: "fix-ci",
        on: "changes_requested",
        iteration_max: 2,
      },
      { from: "await-ci", to: "fix-ci", on: "failed", iteration_max: 2 },
    ]);
    expect(
      edgesOn(line, "fix-ci").filter((edge) => edge.to === "await-ci"),
    ).toEqual([
      { from: "fix-ci", to: "await-ci", on: "success" },
      { from: "fix-ci", to: "await-ci", on: "changes_requested" },
    ]);
  });

  it("ends an onboard run at done when open-pr found nothing on the branch to open a pull request from", () => {
    expect(
      edgesOn(pipelineOf("onboard").line, "open-pr").find(
        (edge) => edge.on === "changes_requested",
      ),
    ).toEqual({ from: "open-pr", to: "done", on: "changes_requested" });
  });

  it("sends no failed outcome of onboard to the exit, and retries every failed station once", () => {
    const { line } = pipelineOf("onboard");
    const failed = line.edges.filter(
      (edge) => edge.on === "failed" && edge.from !== "await-ci",
    );

    expect(
      failed.map((edge) => `${edge.from}>${edge.to}:${edge.iteration_max}`),
    ).toEqual([
      "enrol>enrol:1",
      "author>author:1",
      "open-pr>open-pr:1",
      "fix-ci>fix-ci:1",
      "request-review>request-review:1",
    ]);
  });

  it("keys an onboard run on task_id and makes await-ci a human station producing the three CI feedback values fix-ci needs", () => {
    const { line, stations } = pipelineOf("onboard");
    const produced = stations["onboard-await-ci"].produces.map(
      (value) => value.name,
    );
    const needed = stations["onboard-fix-ci"].needs
      .filter((need) => need.kind === "value")
      .map((need) => need.name);

    expect(subjectsOf(line)).toEqual(["task_id"]);
    expect(stations["onboard-await-ci"].kind).toBe("human");
    expect(needed).toEqual(produced);
  });

  it("hands both onboard agents the ticket as ticket.md and the branch with write access, and tells them its path", () => {
    const { stations, agent_definitions: agents } = pipelineOf("onboard");
    const agentNeeds = ["onboard-author", "onboard-fix-ci"].map((station) =>
      stations[station].needs.filter((need) => need.kind !== "value"),
    );
    const prompts = ["onboard-author", "onboard-fix-ci"].map(
      (agent) => agents![agent].settings.prompt,
    );

    expect(agentNeeds).toEqual([ONBOARD_AGENT_NEEDS, ONBOARD_AGENT_NEEDS]);
    expect(prompts.every((prompt) => prompt.includes("{ticket_path}"))).toBe(
      true,
    );
  });

  it("hands fix-ci the sha, the failed checks and what they printed in its prompt", () => {
    const { prompt } =
      pipelineOf("onboard").agent_definitions!["onboard-fix-ci"].settings;

    expect(prompt).toContain("## CI reported failures on {ci_feedback_sha}");
    expect(prompt).toContain("These checks failed: {ci_failed_checks}");
    expect(prompt).toContain("{ci_failure_summary}");
  });

  it("walks daily-digest from collect through refine to post, reaching post on every outcome of refine", () => {
    const { line } = pipelineOf("daily-digest");

    expect(line.nodes).toEqual([
      { id: "collect", station: "digest-collect" },
      { id: "refine", station: "digest-refine" },
      { id: "post", station: "digest-post" },
      { id: "done" },
    ]);
    expect(edgesOn(line, "refine")).toEqual([
      { from: "refine", to: "post", on: "always" },
    ]);
  });

  it("retries a failed digest collect or post once, so a second failure settles the run as iteration_max and not as success", () => {
    const { line } = pipelineOf("daily-digest");
    const failed = ["collect", "post"].map((node) =>
      edgesOn(line, node).find((edge) => edge.on === "failed"),
    );

    expect(failed).toEqual([
      { from: "collect", to: "collect", on: "failed", iteration_max: 1 },
      { from: "post", to: "post", on: "failed", iteration_max: 1 },
    ]);
  });

  it("keys a daily-digest run on digest_key, hands the agent the draft as digest-draft.md and takes digest.md back as an optional need of digest-post", () => {
    const { line, stations } = pipelineOf("daily-digest");
    const refine = stations["digest-refine"];
    const post = stations["digest-post"];

    expect({
      subject: line.args.digest_key,
      draft: refine.needs[0],
      message: refine.produces,
      messageNeed: post.needs.find((need) => need.name === "digest_message"),
    }).toEqual({
      subject: { kind: "value", subject: true },
      draft: { name: "digest_draft", kind: "file", path: "digest-draft.md" },
      message: [{ name: "digest_message", kind: "file", path: "digest.md" }],
      messageNeed: { name: "digest_message", kind: "file", optional: true },
    });
  });

  it("tells the digest agent the draft's and the message's paths, and names no repository clone", () => {
    const prompt =
      pipelineOf("daily-digest").agent_definitions?.["digest-refine"].settings
        .prompt ?? "";

    expect(prompt).toContain("{digest_draft_path}");
    expect(prompt).toContain("{digest_message_path}");
    expect(prompt).not.toContain("clone");
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

  it("keys code-review on pr_url, code-review-recheck on head_sha and code-review-reply on review_id, so a re-check never joins an open review, two re-checks of one sha are one run, and one review is answered once", () => {
    const subjectArgs = (id: string): string[] =>
      Object.entries(pipelineOf(id).line.args)
        .filter(([, arg]) => arg.subject)
        .map(([name]) => name);

    expect({
      review: subjectArgs("code-review"),
      recheck: subjectArgs("code-review-recheck"),
      reply: subjectArgs("code-review-reply"),
    }).toEqual({
      review: ["pr_url"],
      recheck: ["head_sha"],
      reply: ["review_id"],
    });
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

  it("starts code-review-reply from the repository, the pull request and the review alone, and gives post-reply the review id so each answer lands under a comment of that review", () => {
    const { line, stations } = pipelineOf("code-review-reply");

    expect({
      args: Object.keys(line.args),
      readReview: stations["read-review"]?.needs.map((need) => need.name),
      postReply: stations["post-reply"]?.needs.map((need) => need.name),
    }).toEqual({
      args: ["repo", "pr_url", "review_id"],
      readReview: ["pr_url", "review_id"],
      postReply: ["reply_output", "pr_url", "review_id"],
    });
  });

  it("tells the reply agent to answer each line comment by its id, shows both reply blocks whole, and promises it no intent and no thread it was not given", () => {
    const prompt = promptOnOneLine("code-review-refine");

    expect({
      answersById: prompt.includes("`inline comment <id> on <path>`"),
      replyBlock: prompt.includes("```REVIEW_REPLY"),
      threadBlock: [
        "```REVIEW_THREAD_REPLIES",
        '"comment_id"',
        '"reply"',
        '"resolved"',
      ].every((part) => prompt.includes(part)),
      namesAnIntent: /intent/i.test(prompt),
      postsItself: prompt.includes("post one clarifying question"),
    }).toEqual({
      answersById: true,
      replyBlock: true,
      threadBlock: true,
      namesAnIntent: false,
      postsItself: false,
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
  it("grounds the plan between plan-pass-end and author, reading the default branch and nothing from the bag", () => {
    const { line, stations } = pipelineOf("feature-planning");
    const node = line.nodes.find((each) => each.id === "plan-grounding");

    expect({
      station: node?.station,
      base: node?.bind,
      from: edgesOn(line, "plan-pass-end").map((edge) => [edge.to, edge.on]),
      to: edgesOn(line, "plan-grounding").map((edge) => [edge.to, edge.on]),
      planMd: needOf(stations["plan-grounding"], "plan_md"),
      target: needOf(stations["plan-grounding"], "target"),
    }).toEqual({
      station: "plan-grounding",
      base: { target: "base" },
      from: [["plan-grounding", "always"]],
      to: [["author", "always"]],
      planMd: undefined,
      target: { name: "target", kind: "git", path: "target", access: "read" },
    });
  });

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
        "issue-coverage",
        "issues",
        "merged",
        "open-spec-pr",
        "plan-findings",
        "plan-grounding",
        "plan-pass-end",
        "spec-coverage",
        "validate",
        "write",
      ].sort(),
      validateStart: "plan-validate",
    });
  });

  it("checks plan coverage between write and open-spec-pr, sending write back at most COVERAGE_ROUNDS times", () => {
    const { line } = pipelineOf("feature-planning");

    expect({
      fromWrite: edgesOn(line, "write").find((edge) => edge.on === "success"),
      fromCoverage: edgesOn(line, "spec-coverage"),
    }).toEqual({
      fromWrite: { from: "write", to: "spec-coverage", on: "success" },
      fromCoverage: [
        { from: "spec-coverage", to: "open-spec-pr", on: "success" },
        {
          from: "spec-coverage",
          to: "write",
          on: "changes_requested",
          iteration_max: COVERAGE_ROUNDS,
        },
        { from: "spec-coverage", to: "done", on: "failed" },
      ],
    });
  });

  it("checks issue coverage after issues, sending decompose back at most COVERAGE_ROUNDS times", () => {
    const { line } = pipelineOf("feature-planning");

    expect({
      fromIssues: edgesOn(line, "issues").find((edge) => edge.on === "success"),
      fromCoverage: edgesOn(line, "issue-coverage"),
    }).toEqual({
      fromIssues: { from: "issues", to: "issue-coverage", on: "success" },
      fromCoverage: [
        { from: "issue-coverage", to: "done", on: "success" },
        {
          from: "issue-coverage",
          to: "decompose",
          on: "changes_requested",
          iteration_max: COVERAGE_ROUNDS,
        },
        { from: "issue-coverage", to: "done", on: "failed" },
      ],
    });
  });

  it("hands feature-decompose its last decomposition and issue coverage as optional files its prompt names", () => {
    const decompose =
      pipelineOf("feature-planning").stations["feature-decompose"];
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      decomposition: needOf(decompose, "decomposition"),
      coverage: needOf(decompose, "issue_coverage"),
      named: [
        prompt.includes("/workspace/decomposition.json"),
        prompt.includes("/workspace/issue-coverage.md"),
      ],
    }).toEqual({
      named: [true, true],
      decomposition: {
        name: "decomposition",
        kind: "file",
        path: "decomposition.json",
        optional: true,
      },
      coverage: {
        name: "issue_coverage",
        kind: "file",
        path: "issue-coverage.md",
        optional: true,
      },
    });
  });

  it("hands spec-write the citable plan blocks and the last coverage as optional files its prompt names", () => {
    const write = pipelineOf("feature-planning").stations["spec-write"];
    const prompt = promptOnOneLine("spec-write");

    expect({
      blocks: needOf(write, "plan_blocks"),
      coverage: needOf(write, "plan_coverage"),
      named: [
        prompt.includes("/workspace/plan-blocks.json"),
        prompt.includes("/workspace/plan-coverage.md"),
      ],
    }).toEqual({
      named: [true, true],
      blocks: {
        name: "plan_blocks",
        kind: "file",
        path: "plan-blocks.json",
        optional: true,
      },
      coverage: {
        name: "plan_coverage",
        kind: "file",
        path: "plan-coverage.md",
        optional: true,
      },
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

  it("has validate read the default branch as it stands when the visit opens, not the spec branch cut when the run started", () => {
    const { line } = pipelineOf("feature-planning");

    expect(line.nodes.find((node) => node.id === "validate")?.bind).toEqual({
      target: "base",
    });
  });

  it("hands every validate visit to plan-findings, which writes the findings into the plan before the author waits again", () => {
    const { line, stations } = pipelineOf("feature-planning");

    expect({
      fromValidate: edgesOn(line, "validate"),
      fromFindings: edgesOn(line, "plan-findings"),
      station: line.nodes.find((node) => node.id === "plan-findings")?.station,
      findings: stations["plan-findings"],
    }).toEqual({
      fromValidate: [{ from: "validate", to: "plan-findings", on: "always" }],
      fromFindings: [{ from: "plan-findings", to: "author", on: "always" }],
      station: "plan-findings",
      findings: {
        kind: "service",
        outcomes: ["success", "failed"],
        needs: [
          { name: "plan_id", kind: "value" },
          { name: "plan_validation", kind: "file", optional: true },
        ],
        produces: [],
      },
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
          "Pass `repo` (the owner/name your task names above) on every `lore_*` call",
        ),
      ),
    ).toEqual(agents.map(() => true));
  });

  it("gives feature-decompose the approved plan as plan.md and the spec_path value, and names both in its prompt", () => {
    const decompose =
      pipelineOf("feature-planning").stations["feature-decompose"];
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      planMd: needOf(decompose, "plan_md"),
      specPath: needOf(decompose, "spec_path"),
      namesPlan: prompt.includes("{plan_md_path}"),
      namesSpecPath: prompt.includes("{spec_path}"),
    }).toEqual({
      planMd: { name: "plan_md", kind: "file", path: "plan.md" },
      specPath: { name: "spec_path", kind: "value" },
      namesPlan: true,
      namesSpecPath: true,
    });
  });

  it("gives feature-decompose every spec the plan touched as spec-plan.json and the citable plan blocks, and names both in its prompt", () => {
    const decompose =
      pipelineOf("feature-planning").stations["feature-decompose"];
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      specPlan: needOf(decompose, "spec_plan"),
      blocks: needOf(decompose, "plan_blocks"),
      named: [
        prompt.includes("{spec_plan_path}"),
        prompt.includes("/workspace/plan-blocks.json"),
      ],
    }).toEqual({
      specPlan: { name: "spec_plan", kind: "file", path: "spec-plan.json" },
      blocks: {
        name: "plan_blocks",
        kind: "file",
        path: "plan-blocks.json",
        optional: true,
      },
      named: [true, true],
    });
  });

  it("runs feature-decompose on gemini-3.1-pro-preview at 2 and 12 dollars per million input and output tokens", () => {
    const { settings } =
      pipelineOf("feature-planning").agent_definitions!["feature-decompose"]!;

    expect({ model: settings.model, prices: settings.prices }).toEqual({
      model: "gemini-3.1-pro-preview",
      prices: {
        "gemini-3.1-pro-preview": {
          input_per_million: 2,
          output_per_million: 12,
        },
      },
    });
  });

  it("gives the issues station the approved plan as an optional plan_md, to fold into the story issue", () => {
    const issues = pipelineOf("feature-planning").stations["issues"];

    expect(needOf(issues, "plan_md")).toEqual({
      name: "plan_md",
      kind: "file",
      optional: true,
    });
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
        "Pass `repo` (the owner/name your task names above) on every `lore_*` call",
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
    .map((file) =>
      withAgentPrompts(
        parse(readFileSync(new URL(file, folder), "utf8")) as Pipeline,
      ),
    );

  return new Map(pipelines.map((pipeline) => [pipeline.line.id, pipeline]));
}

function pipelineOf(id: string): Pipeline {
  const pipeline = PIPELINES.get(id);

  enforceTrue(pipeline !== undefined, Error, `no floor pipeline ${id}`);

  return pipeline;
}

function subjectsOf(line: Pipeline["line"]): string[] {
  return Object.entries(line.args)
    .filter(([, arg]) => arg.subject)
    .map(([name]) => name);
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

describe("the files the floor agents produce", () => {
  it("lists no agent file under the target/ clone, so no git add in it can commit one", () => {
    const insideClone = [...PIPELINES.values()]
      .flatMap((pipeline) => Object.entries(pipeline.stations))
      .filter(([, station]) => station.kind === "agent")
      .flatMap(([name, station]) =>
        station.produces.map((output) => `${name}:${output.path ?? ""}`),
      )
      .filter((entry) => entry.includes(":target/"));

    expect(insideClone).toEqual([]);
  });

  it("names every agent's produced file by its path placeholder and never the current directory, which is the root in the pod", () => {
    const agentStations = [...PIPELINES.values()]
      .flatMap((pipeline) => Object.values(pipeline.stations))
      .filter((station) => station.kind === "agent");
    const unnamed = agentStations.flatMap((station) =>
      station.produces
        .filter((output) => output.path !== undefined)
        .filter(
          (output) =>
            !promptOnOneLine(station.agent_definition ?? "").includes(
              `{${output.name}_path}`,
            ),
        )
        .map((output) => `${station.agent_definition}:${output.name}`),
    );
    const sayCurrentDirectory = agentStations
      .map((station) => station.agent_definition ?? "")
      .filter((name) => promptOnOneLine(name).includes("current directory"));

    expect({ unnamed, sayCurrentDirectory }).toEqual({
      unnamed: [],
      sayCurrentDirectory: [],
    });
  });
});
