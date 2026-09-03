import { enforceTrue } from "../../lib/enforce.js";
import type {
  AgentRunnerPort,
  AgentRunResult,
  AgentRunOpts,
} from "./agent-runner-port.js";
import type { LlmPort } from "./llm-port.js";
import type { StationBackend } from "./station-port.js";
import { runClaudeCli } from "./claude-cli.js";

// Agent execution routing to injected providers: local (claude --print), cluster (Station via StationBackend), direct (LlmPort).
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
    const mode = opts?.mode ?? "local";
    const prompt = opts?.prompt ?? `Work on Lore task ${taskId} for ${repo}.`;

    if (mode === "local") {
      const result = await runClaudeCli({
        prompt,
        workDir: opts?.workDir,
        model: opts?.model,
        env: this.env,
      });

      return { taskId, mode, started: result.exitCode === 0 };
    }

    if (mode === "cluster") {
      const station = this.providers.station;

      enforceTrue(
        station,
        Error,
        'agents.run mode "cluster" needs a StationBackend provider',
      );
      const res = await station.launch({
        taskId,
        taskType: opts?.taskType ?? "general",
        description: opts?.description ?? "",
        prompt,
        targetRepo: repo,
        branch: opts?.branch ?? `lore/task-${taskId}`,
        model: opts?.model,
        timeoutMinutes: opts?.timeoutMinutes,
        prNumber: opts?.prNumber,
        name: opts?.name,
        extraLabels: opts?.extraLabels,
        darkFactory: opts?.darkFactory,
        image: opts?.image,
        featureId: opts?.featureId,
        roundFeedback: opts?.roundFeedback,
        resumeFromTask: opts?.resumeFromTask,
        lineArgs: opts?.lineArgs,
      });

      // Sync backends (docker) carry completion; async backends (k8s) omit it (watcher resolves).
      return {
        taskId,
        mode,
        started: res.launched,
        joinedRun: res.joinedRun,
        completion: res.completion,
      };
    }

    const llm = this.providers.llm;

    enforceTrue(
      llm,
      Error,
      'agents.run mode "direct" needs an LlmPort provider',
    );
    await llm.complete(prompt, { model: opts?.model });

    return { taskId, mode, started: true };
  }
}
