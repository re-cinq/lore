"use client";

import { Alert } from "@/components/Alert";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import styles from "./PlanningWizard.module.scss";
import { SubmitButton } from "@/components/SubmitButton";
import GapSections, {
  emptyFeedback,
  toUserAnswers,
  type FeedbackState,
} from "./GapSections";
import RunningCard from "./RunningCard";
import SpecPrCard from "./SpecPrCard";
import DecompositionProgressCard from "./DecompositionProgressCard";
import FailureBlock from "./FailureBlock";
import { isPlanningActive } from "../feature-status";
import { isRewind, lineageLabel, rewindOptions } from "@/lib/round-picker";
import { featurePhaseOf } from "@/lib/feature-phase";
import { useFeaturePlanningPoll } from "./useFeaturePlanningPoll";
import type { FeaturePollPayload } from "@/lib/feature-poll";
import type {
  FeatureWithIterations,
  SectionAnswers,
} from "@/lib/feature-types";

export default function PlanningWizard({
  owner,
  repo,
  feature,
  timeoutMinutes,
  refine,
  onFinalize,
  onCreateDraft,
  settledView,
}: {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  timeoutMinutes: number;
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  onFinalize: (userAnswers: SectionAnswers) => Promise<void>;
  onCreateDraft: (title: string, prompt: string) => void;
  /** What to show once the lifecycle stops moving. The parent owns it — it needs the
   *  decomposition rows, which the poll does not carry — but the WIZARD decides when,
   *  because only the line knows whether an open PR is still being waited on. */
  settledView: ReactNode;
}) {
  // Seeded from the server render so the first paint is not empty; the hook's mount
  // fetch replaces it with the fields only the poll carries (task, run, live output).
  const { data: poll, refresh: fetchLatest } = useFeaturePlanningPoll({
    owner,
    repo,
    featureId: feature.id,
    initial: {
      feature,
      latestIteration:
        feature.iterations[feature.iterations.length - 1] ?? null,
      task: null,
      liveOutput: null,
      lastReady: null,
      run: null,
    },
  });
  const [feedback, setFeedback] = useState<FeedbackState>(emptyFeedback());
  /** Which round the next one continues from; undefined = the latest. */
  const [continueFrom, setContinueFrom] = useState<number | undefined>();
  const [pending, startTransition] = useTransition();
  const [finalizing, setFinalizing] = useState(false);

  const latest = poll.latestIteration;
  // One value instead of five booleans rebuilt from the round's task. The LINE says
  // which node is working; the round's own rows only decide for a legacy feature
  // that resolves no line. `latestReady` still gates the server refresh + which
  // analysis to show, which is a question about the DATA rather than about the phase.
  const phase = featurePhaseOf({
    run: poll.run,
    feature: poll.feature,
    latestIteration: latest,
    task: poll.task,
  });
  const latestReady = latest?.status === "ready" && !!latest.gap_result;
  const failed = phase.kind === "failed";

  useRefreshWhenRoundLands(latestReady, latest?.iteration ?? null);

  // From the server-rendered feature, refreshed by router.refresh() when a round
  // lands — the poll payload carries only the latest iteration, not the history.
  const rounds = rewindOptions(feature.iterations);
  const rewinding = isRewind(rounds, continueFrom);

  const submitRefine = () =>
    startTransition(async () => {
      await refine(toUserAnswers(feedback), continueFrom);
      setFeedback(emptyFeedback());
      setContinueFrom(undefined);
      await fetchLatest();
    });

  // The author fills the form and accepts in one motion, so the accept carries the
  // same answers a refine would. Sending nothing dropped the last thing they said
  // about the plan before it became a spec.
  const submitCreateSpecFile = () =>
    startTransition(async () => {
      setFinalizing(true);
      await onFinalize(toUserAnswers(feedback));
      setFeedback(emptyFeedback());
      await fetchLatest();
    });

  useRefreshWhenPlanningEnds(finalizing, poll.feature.status);

  const iteration = latest?.iteration ?? poll.feature.current_iteration;

  const phaseCard = phaseView({
    phase,
    poll,
    settledView,
    iteration,
    timeoutMinutes,
    finalizing,
    latestCreatedAt: latest?.created_at,
  });

  if (phaseCard) {
    return phaseCard;
  }

  return (
    <AnalysisView
      iteration={iteration}
      failed={failed}
      gap={
        latestReady
          ? (latest?.gap_result ?? null)
          : (poll.lastReady?.gap_result ?? null)
      }
      failureReason={poll.task?.failure_reason}
      answers={latest?.user_answers}
      run={poll.run}
      pending={pending}
      feedback={feedback}
      onChangeFeedback={setFeedback}
      onCreateDraft={onCreateDraft}
      onRefine={submitRefine}
      onCreateSpecPr={submitCreateSpecFile}
      rounds={rounds}
      continueFrom={continueFrom}
      onContinueFrom={setContinueFrom}
      rewinding={rewinding}
    />
  );
}

/**
 * The poll updates THIS component, but the draft spec renders from the server's
 * copy of the feature (FeatureDetailView reads feature.draft_spec_md). Without a
 * refresh, a round that just landed leaves the page showing pre-round data until
 * the reader thinks to reload. Once per iteration — refresh() re-renders the
 * parent, which would otherwise re-trigger this on every poll.
 */
function useRefreshWhenRoundLands(
  latestReady: boolean,
  iteration: number | null,
): void {
  const router = useRouter();
  /** Iteration whose completion already triggered a server refresh. */
  const refreshedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!latestReady || refreshedFor.current === iteration) {
      return;
    }

    refreshedFor.current = iteration;
    router.refresh();
  }, [latestReady, iteration, router]);
}

/**
 * After finalize, the feature-finalize task runs async (no intermediate status). The
 * poll is already running, so this only watches its payload: once the feature leaves
 * the planning phase (→ pr-open), refresh the server component so the parent swaps
 * the wizard for the FinalizedView. A second interval here would just re-ask the
 * same route on its own schedule.
 */
function useRefreshWhenPlanningEnds(
  finalizing: boolean,
  featureStatus: Parameters<typeof isPlanningActive>[0],
): void {
  const router = useRouter();

  useEffect(() => {
    if (finalizing && !isPlanningActive(featureStatus)) {
      router.refresh();
    }
  }, [finalizing, featureStatus, router]);
}

/** What the author acts on between rounds: the analysis, the answer form, and the two ways forward. A failed latest round shows its banner ABOVE the preserved sections, so a fix-and-retry never costs the analysis. */
function AnalysisView({
  iteration,
  failed,
  gap,
  failureReason,
  answers,
  run,
  pending,
  feedback,
  onChangeFeedback,
  onCreateDraft,
  onRefine,
  onCreateSpecPr,
  rounds,
  continueFrom,
  onContinueFrom,
  rewinding,
}: {
  iteration: number;
  failed: boolean;
  gap: Parameters<typeof GapSections>[0]["gap"] | null | undefined;
  failureReason: Parameters<typeof FailureBlock>[0]["failureReason"];
  answers: Parameters<typeof FailureBlock>[0]["answers"];
  run: Parameters<typeof FailureBlock>[0]["run"];
  pending: boolean;
  feedback: FeedbackState;
  onChangeFeedback: (next: FeedbackState) => void;
  onCreateDraft: (title: string, prompt: string) => void;
  onRefine: () => void;
  onCreateSpecPr: () => void;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  onContinueFrom: (iteration: number) => void;
  rewinding: boolean;
}) {
  const failureBlock = (
    <FailureBlock
      iteration={iteration}
      failureReason={failureReason}
      answers={answers}
      run={run}
      pending={pending}
      onRetry={onRefine}
    />
  );

  // No analysis ever produced: pure failure (if the latest failed) or an empty state.
  if (!gap) {
    return failed ? (
      failureBlock
    ) : (
      <div className="spec-card">
        <Alert variant="secondary">
          Planning hasn&apos;t produced an analysis yet — it will appear here
          once the first round finishes.
        </Alert>
      </div>
    );
  }

  return (
    <div>
      {failed && <div className={styles.failureSlot}>{failureBlock}</div>}
      <GapSections
        gap={gap}
        feedback={feedback}
        onChange={onChangeFeedback}
        onCreateDraft={onCreateDraft}
      />
      <div className={styles.actions}>
        <SubmitButton
          type="button"
          pending={pending}
          pendingLabel="Working…"
          onClick={onRefine}
        >
          Refine again
        </SubmitButton>
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={onCreateSpecPr}
        >
          Create the spec PR
        </button>
        {rounds.length > 1 && (
          <RewindPicker
            rounds={rounds}
            continueFrom={continueFrom}
            disabled={pending}
            onChange={onContinueFrom}
          />
        )}
      </div>
      {rewinding && (
        <p className={`meta ${styles.rewindNote}`} role="status">
          This round continues round {continueFrom} — rounds after it stay on
          record but are not carried forward.
        </p>
      )}
    </div>
  );
}

/** Which earlier round the next one continues from. Rounds after the chosen one stay on record; they are simply not carried forward. */
function RewindPicker({
  rounds,
  continueFrom,
  disabled,
  onChange,
}: {
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  disabled: boolean;
  onChange: (iteration: number) => void;
}) {
  return (
    <label className={`meta ${styles.continueFrom}`}>
      Continue from{" "}
      <select
        value={continueFrom ?? rounds[0].iteration}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {rounds.map((r) => (
          <option key={r.iteration} value={r.iteration}>
            {lineageLabel(r) ? `${r.label} — ${lineageLabel(r)}` : r.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What the machine is doing, if anything: the finished view, the parked spec PR, the decompose progress, or the running card. Returns null when the line wants nothing said and the author's analysis view takes over. */
function phaseView({
  phase,
  poll,
  settledView,
  iteration,
  timeoutMinutes,
  finalizing,
  latestCreatedAt,
}: {
  phase: ReturnType<typeof featurePhaseOf>;
  poll: FeaturePollPayload;
  settledView: ReactNode;
  iteration: number;
  timeoutMinutes: number;
  finalizing: boolean;
  latestCreatedAt: string | undefined;
}): ReactNode {
  // The lifecycle stopped moving: hand back to the parent's finished view. Gated on
  // the FEATURE as well as the line, because a legacy feature mints one line per
  // round — that line reports `done` the moment its round lands, while the author
  // still has a decision to make.
  if (phase.kind === "done" && !isPlanningActive(poll.feature.status)) {
    return <>{settledView}</>;
  }

  // The spec PR is open and the line is parked on `merged` — waiting on a PERSON,
  // not on the machine. Before the merged line this state was invisible.
  if (phase.kind === "awaiting-merge") {
    return <SpecPrCard feature={poll.feature} />;
  }

  // The merge resumed the line: decompose is breaking the spec down, or the
  // issues station is filing what it produced.
  if (phase.kind === "decomposing") {
    return (
      <DecompositionProgressCard
        nodeId={phase.nodeId}
        since={phase.since}
        // The decompose NODE's attempt — a correction round on the line, which is
        // not the number of planning rounds the author ran before the PR existed.
        iteration={phase.nodeIteration}
      />
    );
  }
  const working = phase.kind === "planning" || phase.kind === "writing-spec";
  // `finalizing` only bridges the gap until the first poll shows the line moving, and
  // never survives it finishing: a line that ends without producing a PR must give the
  // controls back rather than leave a progress card running forever.
  const showSpec =
    phase.kind === "writing-spec" ||
    (finalizing && (poll.run?.status ?? "running") === "running");

  if (!working && !showSpec) {
    return null;
  }

  // The spec phase gets the SAME card as a planning round: it runs on the same line,
  // and the author has no decision to make while it does. Showing the decision row
  // with everything disabled offered two dead controls and hid the run graph.
  return (
    <RunningCard
      iteration={iteration}
      // The working NODE's start, not the round's — a spec node that began 20
      // minutes after the round must not read as 20 minutes over budget.
      since={"since" in phase ? (phase.since ?? latestCreatedAt) : undefined}
      timeoutMinutes={timeoutMinutes}
      // Which node is working, so the card counts against THAT node's kill
      // deadline rather than the planning round's unenforced budget.
      nodeId={"nodeId" in phase ? phase.nodeId : undefined}
      liveOutput={poll.liveOutput}
      run={poll.run}
      phase={showSpec ? "spec" : "round"}
    />
  );
}
