import { enforceTrue } from "../../../lib/enforce.js";
import type {
  AgentRunnerPort,
  AgentRunResult,
  AgentRunOpts,
} from "./agent-runner-port.js";
import type { LlmPort } from "./llm-port.js";
import type { StationBackend } from "./station-port.js";
import { runClaudeCli } from "./claude-cli.js";

// Agent execution routing to injected providers: local (claude --print), cluster (Station via StationBackend), direct (LlmPort).
/** The cluster mode's one precondition: without a backend there is nothing to launch on. */
function requireStation(station: StationBackend | undefined): StationBackend {
  enforceTrue(
    station,
    Error,
    'agents.run mode "cluster" needs a StationBackend provider',
  );

  return station;
}

/** What the backend is asked to run. Only the three fields the pipeline itself owns get defaults here — a task type, a description, and the branch its work lands on. */
function launchSpec(
  { repo, taskId, prompt }: { repo: string; taskId: string; prompt: string },
  runOpts: AgentRunOpts,
) {
  return {
    taskId,
    taskType: runOpts.taskType ?? "general",
    description: runOpts.description ?? "",
    prompt,
    targetRepo: repo,
    branch: runOpts.branch ?? `lore/task-${taskId}`,
    ...passthroughOpts(runOpts),
  };
}

/** Every option the router has no opinion about, forwarded verbatim: the backend, not this router, decides what a missing one means. */
function passthroughOpts(runOpts: AgentRunOpts) {
  return {
    model: runOpts.model,
    timeoutMinutes: runOpts.timeoutMinutes,
    prNumber: runOpts.prNumber,
    name: runOpts.name,
    extraLabels: runOpts.extraLabels,
    darkFactory: runOpts.darkFactory,
    image: runOpts.image,
    featureId: runOpts.featureId,
    roundFeedback: runOpts.roundFeedback,
    resumeFromTask: runOpts.resumeFromTask,
    lineArgs: runOpts.lineArgs,
  };
}

export class AgentRunner implements AgentRunnerPort {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly providers: {
      station?: StationBackend;
      llm?: LlmPort;
    } = {},
  ) {}

  async run(
    repo: string,
    taskId: string,
    opts?: AgentRunOpts,
  ): Promise<AgentRunResult> {
    const runOpts = opts ?? {};
    const mode = runOpts.mode ?? "local";
    const prompt = runOpts.prompt ?? `Work on Lore task ${taskId} for ${repo}.`;

    if (mode === "local") {
      return await this.runLocal(taskId, prompt, runOpts);
    }

    if (mode === "cluster") {
      return await this.runOnCluster(repo, taskId, prompt, runOpts);
    }

    return await this.runDirect(taskId, prompt, runOpts);
  }

  /** `claude --print` in a working directory; the exit code is the whole verdict. */
  private async runLocal(
    taskId: string,
    prompt: string,
    opts?: AgentRunOpts,
  ): Promise<AgentRunResult> {
    const result = await runClaudeCli({
      prompt,
      workDir: opts?.workDir,
      model: opts?.model,
      env: this.env,
    });

    return { taskId, mode: "local", started: result.exitCode === 0 };
  }

  /** A Station launch through the injected backend. Every option is passed through as given: the backend, not this router, decides what a missing one defaults to. */
  private async runOnCluster(
    repo: string,
    taskId: string,
    prompt: string,
    runOpts: AgentRunOpts,
  ): Promise<AgentRunResult> {
    const station = requireStation(this.providers.station);

    // Sync backends (docker) carry completion; async backends (k8s) omit it (watcher resolves).
    const { launched, joinedRun, completion } = await station.launch(
      launchSpec({ repo, taskId, prompt }, runOpts),
    );

    return {
      taskId,
      mode: "cluster",
      started: launched,
      joinedRun,
      completion,
    };
  }

  /** One LLM call, no pod and no repo checkout — the mode for work that is a question, not a change. */
  private async runDirect(
    taskId: string,
    prompt: string,
    opts?: AgentRunOpts,
  ): Promise<AgentRunResult> {
    const llm = this.providers.llm;

    enforceTrue(
      llm,
      Error,
      'agents.run mode "direct" needs an LlmPort provider',
    );
    await llm.complete(prompt, { model: opts?.model });

    return { taskId, mode: "direct", started: true };
  }
}
