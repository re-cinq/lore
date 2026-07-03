import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  formatTrailers,
  lastStageOnBranch,
  type Trailers,
} from "@re-cinq/lore-shared/commit-trailers.js";
import type { AssemblyLine, AssemblyLineNode } from "./loader.js";
import type { LeaseBackend } from "@re-cinq/lore-shared/project/leases/lease-backends.js";

const execFile = promisify(execFileCb);

export type StageOutcome = "success" | "changes_requested" | "failed";

export interface NodeResult {
  outcome: StageOutcome;
  /**
   * Free-form extra trailers (e.g. `Lore-Cost-Tokens`, `Lore-Validation-Status`).
   * Merged into the stage commit's trailer block.
   */
  extras?: Record<string, string>;
}

export interface NodeContext {
  taskId: string;
  branchName: string;
  gitDir: string;
  iteration: number;
  assemblyLineName: string;
}

export type NodeHandler = (
  node: AssemblyLineNode,
  ctx: NodeContext,
) => Promise<NodeResult>;

export interface NodeHandlers {
  agent: NodeHandler;
  validate: NodeHandler;
  gate: NodeHandler;
  retrospective: NodeHandler;
  /** Optional — only assembly lines with a `github_action` node need it (D3). */
  github_action?: NodeHandler;
}

export interface IterationMaxExceededInfo {
  assemblyLineName: string;
  fromNode: string;
  toNode: string;
  iterationMax: number;
  taskId: string;
  branchName: string;
}

/**
 * Typed error thrown when a back-edge's iteration_max is exceeded
 * (T040). Callers should catch this distinctly so they can escalate
 * (`escalate()` from `lib/escalation.ts`) rather than treating it as a
 * generic supervisor crash.
 */
export class IterationMaxExceededError extends Error {
  constructor(public readonly info: IterationMaxExceededInfo) {
    super(
      `AssemblyLine ${info.assemblyLineName}: back-edge ${info.fromNode} → ${info.toNode} exceeded iteration_max=${info.iterationMax}`,
    );
    this.name = "IterationMaxExceededError";
  }
}

export interface ExecuteOptions {
  assemblyLine: AssemblyLine;
  taskId: string;
  branchName: string;
  gitDir: string;
  holder: string;
  leaseBackend: LeaseBackend;
  handlers: NodeHandlers;
  /** Safety guard against runaway loops. Default 200. */
  maxNodes?: number;
  /**
   * Override the git committer for stage commits (used by tests). The
   * supervisor injects identity via env in production.
   */
  gitCommit?: (
    gitDir: string,
    subject: string,
    body: string,
  ) => Promise<void>;
  /**
   * Optional hook fired before {@link IterationMaxExceededError} is
   * thrown. The supervisor wires this to `escalate()` so a stuck task
   * produces a `needs-human-help` Issue + Slack ping with full context.
   * Hook errors are caught + logged; the original throw still fires.
   */
  onIterationMaxExceeded?: (info: IterationMaxExceededInfo) => Promise<void>;
}

export interface ExecutionSummary {
  visited: Array<{
    nodeId: string;
    outcome: StageOutcome;
    iteration: number;
  }>;
  resumedFromNode?: string;
  reachedExit: boolean;
}

const DEFAULT_MAX_NODES = 200;

/**
 * Walk the assembly line for one task. Each node is dispatched to its
 * handler; the executor commits a stage commit with structured trailers
 * after the handler returns. Outcomes drive edge selection. The lease
 * is refreshed before every node.
 *
 * Resume semantics (T015): on entry, parse the most recent
 * `Lore-Stage:` trailer on the branch. If found and it maps to a node
 * in the assembly line, follow the outcome-matching outgoing edge to find
 * the next node. Stages already committed are not re-executed (FR1.2).
 */
export async function executeAssemblyLine(
  opts: ExecuteOptions,
): Promise<ExecutionSummary> {
  const { assemblyLine, branchName, holder, leaseBackend, handlers } = opts;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const commit = opts.gitCommit ?? defaultGitCommit;

  const resume = await resumeFromBranch(assemblyLine, branchName, opts.gitDir);
  let currentId = resume?.nextNode ?? assemblyLine.entry;
  let iteration = resume?.iteration ?? 1;

  const visited: ExecutionSummary["visited"] = [];
  const backEdgeCounts = new Map<string, number>();

  for (let step = 0; step < maxNodes; step++) {
    if (currentId === assemblyLine.exit) {
      return {
        visited,
        resumedFromNode: resume?.nextNode,
        reachedExit: true,
      };
    }

    const node = assemblyLine.nodes.find((n) => n.id === currentId);
    if (!node) {
      throw new Error(
        `AssemblyLine ${assemblyLine.name}: unknown node "${currentId}"`,
      );
    }

    await leaseBackend.refresh(branchName, holder, undefined, currentId);

    const handler = handlers[node.type];
    if (!handler) {
      throw new Error(
        `AssemblyLine ${assemblyLine.name}: no handler registered for node type "${node.type}" (node "${currentId}")`,
      );
    }
    const result = await handler(node, {
      taskId: opts.taskId,
      branchName,
      gitDir: opts.gitDir,
      iteration,
      assemblyLineName: assemblyLine.name,
    });

    await emitStageCommit(commit, opts.gitDir, {
      stage: currentId,
      iteration,
      taskId: opts.taskId,
      outcome: result.outcome,
      extras: result.extras,
    });

    visited.push({ nodeId: currentId, outcome: result.outcome, iteration });

    const candidates = assemblyLine.edges.filter(
      (e) =>
        e.from === currentId &&
        (e.on === result.outcome || e.on === "always"),
    );
    if (candidates.length === 0) {
      throw new Error(
        `AssemblyLine ${assemblyLine.name}: no edge from "${currentId}" for outcome "${result.outcome}"`,
      );
    }
    const matchOutcome = candidates.find((e) => e.on === result.outcome);
    const chosen = matchOutcome ?? candidates[0];

    if (chosen.iteration_max !== undefined) {
      const key = `${chosen.from}->${chosen.to}`;
      const count = (backEdgeCounts.get(key) ?? 0) + 1;
      if (count > chosen.iteration_max) {
        const info: IterationMaxExceededInfo = {
          assemblyLineName: assemblyLine.name,
          fromNode: chosen.from,
          toNode: chosen.to,
          iterationMax: chosen.iteration_max,
          taskId: opts.taskId,
          branchName,
        };
        if (opts.onIterationMaxExceeded) {
          try {
            await opts.onIterationMaxExceeded(info);
          } catch (err) {
            console.warn(
              "[assembly-line-executor] onIterationMaxExceeded hook failed:",
              (err as Error).message,
            );
          }
        }
        throw new IterationMaxExceededError(info);
      }
      backEdgeCounts.set(key, count);
      iteration = count + 1;
    }

    currentId = chosen.to;
  }

  throw new Error(
    `AssemblyLine ${assemblyLine.name}: maxNodes (${maxNodes}) reached without hitting exit`,
  );
}

interface ResumePoint {
  nextNode: string;
  iteration: number;
}

async function resumeFromBranch(
  assemblyLine: AssemblyLine,
  branchName: string,
  gitDir: string,
): Promise<ResumePoint | null> {
  const trailers = await lastStageOnBranch(branchName, gitDir);
  if (!trailers) return null;
  return resumeFromTrailers(assemblyLine, trailers);
}

/**
 * Pure helper (exported for testing). Given a trailer block from the
 * branch's most recent commit, find the node it represents and follow
 * the outcome-matching edge to the next node.
 *
 * Returns null when the trailer's stage isn't in this assembly line (stale
 * branch / assembly line rename — caller restarts from entry) or when no
 * matching outgoing edge exists.
 */
export function resumeFromTrailers(
  assemblyLine: AssemblyLine,
  trailers: Trailers,
): ResumePoint | null {
  const stageNode = assemblyLine.nodes.find((n) => n.id === trailers.stage);
  if (!stageNode) return null;

  const outcome =
    (trailers.extras?.["Lore-Outcome"] as StageOutcome | undefined) ??
    "success";

  const edge = assemblyLine.edges.find(
    (e) =>
      e.from === trailers.stage && (e.on === outcome || e.on === "always"),
  );
  if (!edge) return null;

  return { nextNode: edge.to, iteration: trailers.iteration };
}

interface EmitArgs {
  stage: string;
  iteration: number;
  taskId: string;
  outcome: StageOutcome;
  extras?: Record<string, string>;
}

async function emitStageCommit(
  commit: (gitDir: string, subject: string, body: string) => Promise<void>,
  gitDir: string,
  args: EmitArgs,
): Promise<void> {
  const trailerBlock = formatTrailers({
    stage: args.stage,
    iteration: args.iteration,
    taskId: args.taskId,
    extras: { "Lore-Outcome": args.outcome, ...(args.extras ?? {}) },
  });
  const subject = `[stage:${args.stage}] iter=${args.iteration}`;
  const body = `\n\n${trailerBlock}`;
  await commit(gitDir, subject, body);
}

/**
 * Default committer: stages everything in the working tree and creates
 * a (possibly empty) commit. Empty commits are intentional for nodes
 * that produce no file changes (FR1.3 — validate, gate, retrospective).
 */
async function defaultGitCommit(
  gitDir: string,
  subject: string,
  body: string,
): Promise<void> {
  await execFile("git", ["-C", gitDir, "add", "-A"]);
  await execFile("git", [
    "-C",
    gitDir,
    "commit",
    "--allow-empty",
    "-m",
    subject + body,
  ]);
}

/**
 * Pre-built handler set covering the three node types whose behavior is
 * fixed in Phase 3. `validate`, `gate`, and `retrospective` have
 * deterministic semantics that don't need per-flow customization.
 * `agent` handlers are provided per-caller (LLM dispatch is feature work).
 *
 * `validate` — runs the configured validator (T032 wires the actual
 * lint/typecheck hooks). Stub returns success here.
 *
 * `gate` — evaluates the configured `condition_ref`. Stub returns
 * success; T021 plugs in `auto_merge_eligible`, etc.
 *
 * `retrospective` — emits the episode + curated memory. Stub returns
 * success; the episode-writer integration lands alongside auto-merge.
 */
export const builtinHandlers: Omit<NodeHandlers, "agent"> = {
  validate: async () => ({ outcome: "success" }),
  gate: async () => ({ outcome: "success" }),
  retrospective: async () => ({ outcome: "success" }),
};
