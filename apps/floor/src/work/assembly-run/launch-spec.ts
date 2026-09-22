// The spec ONE node dispatch runs with — first launch and reaper relaunch alike; a second builder here previously dropped conversation continuity and the station-run id label on relaunch (#1466, FR-15.13), so a field added here must reach both doors or neither.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { withCiFeedback, type CiFeedback } from "./ci-feedback.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  nodeAgentSpec,
  nodeStationSpec,
  type FloorAssemblyRunTask,
} from "./floor-assembly-run.js";
import { resolveRoundContent } from "./round-content.js";
import {
  inputFilesFor,
  type InputFiles,
  type RecipeInput,
} from "./input-files.js";

/** Resolve a node's `continues` declaration into the conversation this run resumes and saves as. Optional seam — a composition without it never continues. */
export type ResolveConversationFn = (
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  iteration: number,
  priorOutcome: string | null,
) => Promise<LoreTaskSpec["conversation"] | undefined>;

/** What a dispatch takes from an agent node's RESOLVED recipe: the prompt its pod renders, and the files it downloads first. */
export interface NodeRecipe {
  prompt: string;
  inputs?: readonly RecipeInput[];
}

/** Resolves the recipe for `repo` (project row → org row → yaml) in one read, so an Agents-UI edit reaches the pod; strict on an unknown ref (#1329). */
export type ResolveRecipeFn = (
  repo: string,
  promptRef: string,
  description: string,
) => Promise<NodeRecipe>;

export interface NodeLaunchDeps {
  resolveRecipe: ResolveRecipeFn;
  resolveConversation?: ResolveConversationFn;
}

export interface NodeLaunchInput {
  node: RunGraphNode;
  task: FloorAssemblyRunTask;
  iteration: number;
  stationRunId: string | undefined;
  /** How a RETRY is told from a next round — the outcome of this node's most recent RECORDED visit. Derive with {@link priorOutcomeOf}. */
  priorOutcome: string | null;
  /** The failure that routed INTO this dispatch, whichever node produced it. Derive with {@link incomingFailureOf}; null when nothing failed before it. */
  incomingFailure?: IncomingFailure | null;
  /** This node's OWN earlier failed attempts, in-run plus (on a forked run) the source runs' visits. Derive the in-run half with {@link priorFailuresOf}; the fork chain is the caller's read. */
  priorFailures?: PriorFailure[];
  /** What CI reported about the push this dispatch answers for. Derive with {@link ciFeedbackOf}; null when the run did not arrive here from a red build. */
  ciFeedback?: CiFeedback | null;
  /** What the previous round said it finished and left for next. Derive with {@link roundHandoffOf}; null before any round reported. */
  roundHandoff?: RoundHandoff | null;
}

/** A round's own account of itself, lifted off its `Lore-Tdd-Done` / `Lore-Tdd-Next` extras into the run's args so the NEXT round does not start cold — extras alone never reach a later node (FR6.17). */
export interface RoundHandoff {
  done: string | null;
  next: string;
}

const HANDOFF_EXTRAS = {
  done: "Lore-Tdd-Done",
  next: "Lore-Tdd-Next",
} as const;

/** The args a finishing node's extras add to the run: the hand-off keys, or null when the node reported none. */
export function roundHandoffArgsOf(
  extras: Readonly<Record<string, string>> | undefined,
): Record<string, string> | null {
  const next = extras?.[HANDOFF_EXTRAS.next];

  if (!next) {
    return null;
  }
  const done = extras[HANDOFF_EXTRAS.done];

  return { round_next: next, ...(done ? { round_done: done } : {}) };
}

/** The hand-off the run's args carry, as the next prompt reads it. */
export function roundHandoffOf(
  args: Readonly<Record<string, unknown>>,
): RoundHandoff | null {
  const next = args.round_next;

  if (typeof next !== "string" || next.length === 0) {
    return null;
  }
  const done = args.round_done;

  return { next, done: typeof done === "string" && done ? done : null };
}

/** Append the previous round's report so a round continues where the last one stopped instead of re-deriving it from the branch. */
export function withRoundHandoff(
  prompt: string,
  handoff: RoundHandoff | null,
): string {
  if (!handoff) {
    return prompt;
  }
  const doneLine = handoff.done ? `- Done: ${handoff.done}\n` : "";

  return `${prompt}

## The previous round reported

${doneLine}- Next: ${handoff.next}
`;
}

/** A preceding node's failure, as the next node needs to hear it. */
export interface IncomingFailure {
  nodeId: string;
  detail: string;
}

/** The failure that routed into the next dispatch: the most recently RECORDED visit, but only when it failed — unlike `priorOutcomeOf`, which answers for ONE node and would tell `implement` "success" while `validate` next door actually failed, starving the retry of what broke. */
export function incomingFailureOf(
  visits: ReadonlyArray<{
    nodeId: string;
    outcome: string | null;
    failureDetail?: string | null;
  }>,
): IncomingFailure | null {
  const recorded = visits.filter((v) => v.outcome !== null);
  const last = recorded.at(-1);

  if (!last || !isFailure(last.outcome) || !last.failureDetail) {
    return null;
  }

  return { nodeId: last.nodeId, detail: last.failureDetail };
}

/** Any non-success terminal outcome — `failed`, `<kind>-failed`, and the rest. */
const isFailure = (outcome: string | null): boolean =>
  outcome !== null && outcome !== "success" && outcome !== "changes_requested";

/** One earlier failed attempt of the node being launched, as its retry prompt carries it. */
export interface PriorFailure {
  nodeId: string;
  iteration: number;
  detail: string;
}

/** Every recorded FAILED visit of `nodeId` that carries a detail, oldest first — the launched node's own history, so a retry hears every earlier attempt, not only the one that just routed here. */
export function priorFailuresOf(
  visits: ReadonlyArray<{
    nodeId: string;
    iteration: number;
    outcome: string | null;
    failureDetail?: string | null;
  }>,
  nodeId: string,
): PriorFailure[] {
  return visits
    .filter(
      (v) => v.nodeId === nodeId && isFailure(v.outcome) && v.failureDetail,
    )
    .map((v) => ({
      nodeId: v.nodeId,
      iteration: v.iteration,
      detail: v.failureDetail as string,
    }));
}

/** How much of a preceding failure the next prompt carries — the backstop against a pathological detail crowding out the instructions it is appended to. */
const MAX_FEEDBACK_CHARS = 2500;

/** Append what just failed to the prompt the next node runs on. Kept separate from the prompt TEMPLATE so every agent recipe shares it rather than needing its own copy. */
export function withIncomingFailure(
  prompt: string,
  failure: IncomingFailure | null,
): string {
  if (!failure) {
    return prompt;
  }
  const detail = truncatedDetail(failure.detail);

  return `${prompt}

## The previous step failed — fix this first

The \`${failure.nodeId}\` step failed on your last attempt. You are running
again to correct it. Read the output below, fix the cause, and do not repeat
the change that produced it.

\`\`\`
${detail}
\`\`\`
`;
}

/** The retry prompt carries at most this many earlier attempts — the most recent, closest to what the retry is about to face. */
const MAX_PRIOR_FAILURES = 3;

/** Append the launched node's own earlier failed attempts to its prompt so the agent avoids repeating them. Complements {@link withIncomingFailure} (what just routed here); empty in, prompt out untouched. */
export function withPriorFailures(
  prompt: string,
  failures: readonly PriorFailure[],
): string {
  if (failures.length === 0) {
    return prompt;
  }
  const entries = priorFailureEntries(failures);

  return `${prompt}

## Earlier attempts of this step failed — do not repeat them

This step has failed before. Each attempt below shows what broke. Read them,
avoid the same causes, and take a different approach where the same fix
already failed twice.

${entries}
`;
}

/** The most recent attempts rendered as the prompt's per-attempt blocks, oldest first. */
function priorFailureEntries(failures: readonly PriorFailure[]): string {
  return failures
    .slice(-MAX_PRIOR_FAILURES)
    .map(
      (failure) =>
        `### Attempt ${failure.iteration}\n\n\`\`\`\n${truncatedDetail(failure.detail)}\n\`\`\``,
    )
    .join("\n\n");
}

/** One failure detail, cut to {@link MAX_FEEDBACK_CHARS} with a truncation marker. */
function truncatedDetail(detail: string): string {
  return detail.length > MAX_FEEDBACK_CHARS
    ? `${detail.substring(0, MAX_FEEDBACK_CHARS)}\n...(truncated)`
    : detail;
}

/** The outcome of a node's most recent RECORDED visit, or null if it never ran. An open row (no outcome yet) is the CURRENT visit, not a prior one — the reaper asks this holding the open row, and reading it as prior would tell every relaunch its last attempt had not failed. */
export function priorOutcomeOf(
  visits: ReadonlyArray<{ nodeId: string; outcome: string | null }>,
  nodeId: string,
): string | null {
  // The predicate NARROWS: "recorded" is exactly "has an outcome" — the type stops a later reader reintroducing the open row this excludes.
  const own = visits.filter(
    (v): v is { nodeId: string; outcome: string } =>
      v.nodeId === nodeId && v.outcome !== null,
  );

  return own.length ? own[own.length - 1].outcome : null;
}

/** What one dispatch resolved before anything was written: the conversation this visit continues, the round content it works from, and the prompt its pod renders (null for a station, which runs a deterministic command). */
export interface NodeDispatch {
  conversation: LoreTaskSpec["conversation"] | undefined;
  content: string;
  prompt: string | null;
  files: InputFiles;
}

interface ConversationResolutionInput {
  node: RunGraphNode;
  task: FloorAssemblyRunTask;
  iteration: number;
  priorOutcome: string | null;
}

/** Resolve what a visit is dispatched WITH, before its row is written — separate from the spec build because the station-run row is minted between the two (same module so a field added to one is visible to the other); the conversation resolves FIRST since it decides how much round content the prompt carries (FR-15.11). */
export async function resolveNodeDispatch(
  input: Omit<NodeLaunchInput, "stationRunId">,
  deps: NodeLaunchDeps,
): Promise<NodeDispatch> {
  const conversation = await resolveConversationFor(input, deps);
  const content = resolveRoundContent(input.task, conversation);
  const recipe = await resolvedRecipeFor(promptInput(input, content), deps);

  return {
    conversation,
    content,
    prompt: recipe?.prompt ?? null,
    files: inputFilesFor(recipe?.inputs, input.task.assemblyLineId),
  };
}

// Only agent nodes hold a conversation — a station runs a deterministic command.
async function resolveConversationFor(
  input: ConversationResolutionInput,
  deps: NodeLaunchDeps,
): Promise<LoreTaskSpec["conversation"] | undefined> {
  const { node, task, iteration, priorOutcome } = input;

  if (node.type !== "agent" || !deps.resolveConversation) {
    return undefined;
  }

  return await deps.resolveConversation(node, task, iteration, priorOutcome);
}

/** Everything the prompt is built from, with the two failure channels resolved against each other so a retry does not hear the same failure twice. */
function promptInput(
  input: Omit<NodeLaunchInput, "stationRunId">,
  content: string,
): PromptResolutionInput {
  const incomingFailure = input.incomingFailure ?? null;

  return {
    node: input.node,
    repo: input.task.targetRepo,
    content,
    incomingFailure,
    priorFailures: dedupedPriorFailures(input.priorFailures, incomingFailure),
    ciFeedback: input.ciFeedback ?? null,
    roundHandoff: input.roundHandoff ?? null,
  };
}

// The incoming failure already gets its own block — repeating it as a prior attempt would show the agent the same output twice.
function dedupedPriorFailures(
  priorFailures: readonly PriorFailure[] | undefined,
  incomingFailure: IncomingFailure | null,
): PriorFailure[] {
  return (priorFailures ?? []).filter(
    (f) =>
      !(
        incomingFailure &&
        f.nodeId === incomingFailure.nodeId &&
        f.detail === incomingFailure.detail
      ),
  );
}

interface PromptResolutionInput {
  node: RunGraphNode;
  repo: string;
  content: string;
  incomingFailure: IncomingFailure | null;
  priorFailures: readonly PriorFailure[];
  ciFeedback: CiFeedback | null;
  roundHandoff: RoundHandoff | null;
}

async function resolvedRecipeFor(
  input: PromptResolutionInput,
  deps: NodeLaunchDeps,
): Promise<NodeRecipe | null> {
  const { node, repo, content } = input;

  if (node.type !== "agent") {
    return null;
  }
  const recipe = await deps.resolveRecipe(
    repo,
    node.prompt_ref ?? node.type,
    content,
  );

  return { ...recipe, prompt: withDispatchBlocks(recipe.prompt, input) };
}

/** The blocks appended to a rendered recipe, in the order the pod reads them; CI's verdict comes LAST: it is about the push this node is being launched to repair, where the blocks above it are about attempts that came before. */
function withDispatchBlocks(
  recipe: string,
  input: PromptResolutionInput,
): string {
  return withCiFeedback(
    withPriorFailures(
      withRoundHandoff(
        withIncomingFailure(recipe, input.incomingFailure),
        input.roundHandoff,
      ),
      input.priorFailures,
    ),
    input.ciFeedback,
  );
}

/** Build the dispatch spec from an already-resolved {@link NodeDispatch}. Pure. */
export function nodeLaunchSpec(
  dispatch: NodeDispatch,
  input: NodeLaunchInput,
): LoreTaskSpec {
  const { node, task, iteration, stationRunId } = input;
  const spec =
    node.type === "agent"
      ? nodeAgentSpec(
          node,
          { ...task, description: dispatch.content },
          dispatch.prompt ?? "",
          { iteration, stationRunId },
        )
      : nodeStationSpec(node, task, iteration, stationRunId);

  if (dispatch.conversation) {
    spec.conversation = dispatch.conversation;
  }

  if (dispatch.files.length > 0) {
    spec.files = dispatch.files;
  }

  return spec;
}
