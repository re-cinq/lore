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
  /** Parent owns it for decomposition rows; wizard decides when based on line state. */
  settledView: ReactNode;
}) {
  const router = useRouter();
  // Seeded from server render; hook's mount fetch replaces with poll-only fields (task, run, live output).
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
  /** Undefined = continue from latest. */
  const [continueFrom, setContinueFrom] = useState<number | undefined>();
  const [pending, startTransition] = useTransition();
  const [finalizing, setFinalizing] = useState(false);
  /** Iteration whose completion already triggered server refresh. */
  const refreshedFor = useRef<number | null>(null);

  const latest = poll.latestIteration;
  // One value instead of five booleans; line says which node works; round's rows only for legacy features with no line.
  const phase = featurePhaseOf({
    run: poll.run,
    feature: poll.feature,
    latestIteration: latest,
    task: poll.task,
  });
  const latestReady = latest?.status === "ready" && !!latest.gap_result;
  const failed = phase.kind === "failed";

  // Poll updates this component; refresh() re-renders parent once per iteration when latest round lands.
  useEffect(() => {
    if (!latestReady || refreshedFor.current === latest?.iteration) {
      return;
    }

    refreshedFor.current = latest?.iteration ?? null;
    router.refresh();
  }, [latestReady, latest?.iteration, router]);

  // Server-rendered feature refreshed when round lands; poll carries only latest iteration, not history.
  const rounds = rewindOptions(feature.iterations);
  const rewinding = isRewind(rounds, continueFrom);

  const submitRefine = () =>
    startTransition(async () => {
      await refine(toUserAnswers(feedback), continueFrom);
      setFeedback(emptyFeedback());
      setContinueFrom(undefined);
      await fetchLatest();
    });

  // Accept carries the same answers as refine to avoid dropping last form input.
  const submitCreateSpecFile = () =>
    startTransition(async () => {
      setFinalizing(true);
      await onFinalize(toUserAnswers(feedback));
      setFeedback(emptyFeedback());
      await fetchLatest();
    });

  // Refresh server component when feature leaves planning phase (poll already running); no second interval needed.
  useEffect(() => {
    if (finalizing && !isPlanningActive(poll.feature.status)) {
      router.refresh();
    }
  }, [finalizing, poll.feature.status, router]);

  const iteration = latest?.iteration ?? poll.feature.current_iteration;

  // Spec phase shares same card; `finalizing` bridges gap until line moves; finish without PR gives controls back.
  if (phase.kind === "done" && !isPlanningActive(poll.feature.status)) {
    return <>{settledView}</>;
  }

  // Spec PR open, line parked on `merged`, waiting on a PERSON, not the machine.
  if (phase.kind === "awaiting-merge") {
    return <SpecPrCard feature={poll.feature} />;
  }

  // Merge resumed the line: decompose breaks spec down or issues station files results.
  if (phase.kind === "decomposing") {
    return (
      <DecompositionProgressCard
        nodeId={phase.nodeId}
        since={phase.since}
        // Decompose node's attempt (correction round), not count of pre-PR planning rounds.
        iteration={phase.nodeIteration}
      />
    );
  }

  const working = phase.kind === "planning" || phase.kind === "writing-spec";
  const showSpec =
    phase.kind === "writing-spec" ||
    (finalizing && (poll.run?.status ?? "running") === "running");

  if (working || showSpec) {
    return (
      <RunningCard
        iteration={iteration}
        // Working node's start, not round's; spec node that began after round must not read as over budget.
        since={
          "since" in phase ? (phase.since ?? latest?.created_at) : undefined
        }
        timeoutMinutes={timeoutMinutes}
        // Card counts against working node's deadline, not round's unenforced budget.
        nodeId={"nodeId" in phase ? phase.nodeId : undefined}
        liveOutput={poll.liveOutput}
        run={poll.run}
        phase={showSpec ? "spec" : "round"}
      />
    );
  }

  // Latest round's result, else most recent round that produced one (failed refine doesn't hide prior analysis).
  const gap = latestReady
    ? latest?.gap_result
    : (poll.lastReady?.gap_result ?? null);

  const failureBlock = (
    <FailureBlock
      iteration={iteration}
      failureReason={poll.task?.failure_reason}
      answers={latest?.user_answers}
      run={poll.run}
      pending={pending}
      onRetry={submitRefine}
    />
  );

  // Pure failure (if latest failed) or empty state if no analysis was produced.
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

  // Show failure banner above preserved sections so user can fix + retry without losing analysis.
  return (
    <div>
      {failed && <div className={styles.failureSlot}>{failureBlock}</div>}
      <GapSections
        gap={gap}
        feedback={feedback}
        onChange={setFeedback}
        onCreateDraft={onCreateDraft}
      />
      <div className={styles.actions}>
        <SubmitButton
          type="button"
          pending={pending}
          pendingLabel="Working…"
          onClick={submitRefine}
        >
          Refine again
        </SubmitButton>
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={submitCreateSpecFile}
        >
          Create the spec PR
        </button>
        {rounds.length > 1 && (
          <label className={`meta ${styles.continueFrom}`}>
            Continue from{" "}
            <select
              value={continueFrom ?? rounds[0].iteration}
              disabled={pending}
              onChange={(e) => setContinueFrom(Number(e.target.value))}
            >
              {rounds.map((r) => (
                <option key={r.iteration} value={r.iteration}>
                  {lineageLabel(r)
                    ? `${r.label} — ${lineageLabel(r)}`
                    : r.label}
                </option>
              ))}
            </select>
          </label>
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
