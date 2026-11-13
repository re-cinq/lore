import { Alert } from "@/components/Alert";
import type { PlanPageState } from "@/lib/plan-page-state";
import { LAST_PASS_FAILED, planRunPhase } from "@/lib/plan-run-phase";
import type { RefineFailure } from "@re-cinq/planning-editor";
import { planRunSummary, planRunTone, type PlanRun } from "./PlanRunCard";
import styles from "./PlanRunNotice.module.scss";

interface PlanRunNoticeProps {
  run: PlanRun | null;
  state: PlanPageState;
  refineFailures: readonly RefineFailure[];
}

/** What went wrong with the planning agent's work, as warnings that name the section where one is to blame; nothing while all is well. */
export default function PlanRunNotice(props: PlanRunNoticeProps) {
  const messages = noticeMessages(props);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className={styles.notice}>
      {messages.map((message) => (
        <Alert key={message} variant="warning">
          {message}
        </Alert>
      ))}
    </div>
  );
}

function noticeMessages({
  run,
  state,
  refineFailures,
}: PlanRunNoticeProps): string[] {
  if (planRunTone(run, state) === "working") {
    return [];
  }

  return [
    ...refineFailures.map(refineMessage),
    ...sketchMessages(run, refineFailures),
    ...runMessages(run, state, refineFailures),
  ];
}

// The newest agent pass decides: a sketch that failed and was not since redrawn or overtaken by a planning pass. A failed Refine of the Prototype section already says so in its own words.
function sketchMessages(
  run: PlanRun | null,
  refineFailures: readonly RefineFailure[],
): string[] {
  const lastPass = run?.nodes.findLast((visit) =>
    AGENT_PASSES.has(visit.nodeId),
  );

  if (lastPass?.nodeId !== "sketch" || lastPass.outcome !== "failed") {
    return [];
  }

  return refineFailures.some(({ slot }) => slot === "prototype")
    ? []
    : [sketchMessage(lastPass.failureDetail)];
}

const AGENT_PASSES = new Set(["analyze", "sketch"]);

function sketchMessage(reason: string | null | undefined): string {
  return `The agent could not draw the prototype: ${reason ?? "no reason was recorded"}. Generate it again from the Prototype section.`;
}

function refineMessage({ title, reason }: RefineFailure): string {
  return `The planning agent could not refine "${title}": ${reason}. Ask again from that section, or regenerate the plan.`;
}

function runMessages(
  run: PlanRun | null,
  state: PlanPageState,
  refineFailures: readonly RefineFailure[],
): string[] {
  if (!run || planRunTone(run, state) !== "failed") {
    return [];
  }

  if (state === "spec-work-failed" || !lastPassFailed(run)) {
    return [planRunSummary(run, state)];
  }

  return refineFailures.length > 0 ? [] : [draftMessage(run)];
}

function lastPassFailed(run: PlanRun): boolean {
  return planRunPhase(run, run.nodes) === LAST_PASS_FAILED;
}

function draftMessage(run: PlanRun): string {
  const failedPass = run.nodes.findLast(
    (visit) => visit.nodeId === "analyze" && visit.outcome === "failed",
  );
  const reason = failedPass?.failureDetail ?? "no reason was recorded";

  return `The planning agent could not draft the plan: ${reason}. Regenerate the plan to ask again.`;
}
