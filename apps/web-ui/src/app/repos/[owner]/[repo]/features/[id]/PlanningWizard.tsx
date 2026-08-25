"use client";

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
  /** What to show once the lifecycle stops moving. The parent owns it — it needs the
   *  decomposition rows, which the poll does not carry — but the WIZARD decides when,
   *  because only the line knows whether an open PR is still being waited on. */
  settledView: ReactNode;
}) {
  const router = useRouter();
  // Seeded from the server render so the first paint is not empty; the hook's mount
  // fetch replaces it with the fields only the poll carries (task, run, live output).
  const { data, refresh: fetchLatest } = useFeaturePlanningPoll({
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
  /** Iteration whose completion already triggered a server refresh. */
  const refreshedFor = useRef<number | null>(null);

  const latest = data.latestIteration;
  // One value instead of five booleans rebuilt from the round's task. The LINE says
  // which node is working; the round's own rows only decide for a legacy feature
  // that resolves no line. `latestReady` still gates the server refresh + which
  // analysis to show, which is a question about the DATA rather than about the phase.
  const phase = featurePhaseOf({
    run: data.run,
    feature: data.feature,
    latestIteration: latest,
    task: data.task,
  });
  const latestReady = latest?.status === "ready" && !!latest.gap_result;
  const failed = phase.kind === "failed";

  // The poll updates THIS component, but the draft spec renders from the server's
  // copy of the feature (FeatureDetailView reads feature.draft_spec_md). Without a
  // refresh, a round that just landed leaves the page showing pre-round data until
  // the reader thinks to reload. Once per iteration — refresh() re-renders the
  // parent, which would otherwise re-trigger this on every poll.
  useEffect(() => {
    if (!latestReady || refreshedFor.current === latest?.iteration) {
      return;
    }

    refreshedFor.current = latest?.iteration ?? null;
    router.refresh();
  }, [latestReady, latest?.iteration, router]);

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

  // After finalize, the feature-finalize task runs async (no intermediate status). The
  // poll is already running, so this only watches its payload: once the feature leaves
  // the planning phase (→ pr-open), refresh the server component so the parent swaps
  // the wizard for the FinalizedView. A second interval here would just re-ask the
  // same route on its own schedule.
  useEffect(() => {
    if (finalizing && !isPlanningActive(data.feature.status)) {
      router.refresh();
    }
  }, [finalizing, data.feature.status, router]);

  const iteration = latest?.iteration ?? data.feature.current_iteration;

  // The spec phase gets the SAME card as a planning round: it runs on the same line,
  // and the author has no decision to make while it does. Showing the decision row
  // with everything disabled — a greyed "Refine again" beside a primary relabelled
  // "Creating the spec PR…" — offered two dead controls and hid the run graph, which
  // only ever rendered here.
  // `finalizing` only bridges the gap until the first poll shows the line moving, and
  // never survives it finishing: a line that ends without producing a PR must give the
  // controls back rather than leave a progress card running forever.
  // The lifecycle stopped moving: hand back to the parent's finished view. Gated on
  // the FEATURE as well as the line, because a legacy feature mints one line per
  // round — that line reports `done` the moment its round lands, while the author
  // still has a decision to make.
  if (phase.kind === "done" && !isPlanningActive(data.feature.status)) {
    return <>{settledView}</>;
  }

  // The spec PR is open and the line is parked on `merged` — waiting on a PERSON,
  // not on the machine. Before the merged line this state was invisible.
  if (phase.kind === "awaiting-merge") {
    return <SpecPrCard feature={data.feature} />;
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
  const showSpec =
    phase.kind === "writing-spec" ||
    (finalizing && (data.run?.status ?? "running") === "running");

  if (working || showSpec) {
    return (
      <RunningCard
        iteration={iteration}
        // The working NODE's start, not the round's — a spec node that began 20
        // minutes after the round must not read as 20 minutes over budget.
        since={
          "since" in phase ? (phase.since ?? latest?.created_at) : undefined
        }
        timeoutMinutes={timeoutMinutes}
        // Which node is working, so the card counts against THAT node's kill
        // deadline rather than the planning round's unenforced budget.
        nodeId={"nodeId" in phase ? phase.nodeId : undefined}
        liveOutput={data.liveOutput}
        run={data.run}
        phase={showSpec ? "spec" : "round"}
      />
    );
  }

  // The analysis to show: the latest round's result, else the most recent round that
  // produced one (so a failed refine doesn't hide your prior analysis).
  const gap = latestReady
    ? latest?.gap_result
    : (data.lastReady?.gap_result ?? null);

  const failureBlock = (
    <FailureBlock
      iteration={iteration}
      failureReason={data.task?.failure_reason}
      answers={latest?.user_answers}
      run={data.run}
      pending={pending}
      onRetry={submitRefine}
    />
  );

  // No analysis ever produced: pure failure (if the latest failed) or an empty state.
  if (!gap) {
    return failed ? (
      failureBlock
    ) : (
      <div className="spec-card">
        <p className="meta">
          Planning hasn&apos;t produced an analysis yet — it will appear here
          once the first round finishes.
        </p>
      </div>
    );
  }

  // We have an analysis to work with. If the latest round failed, show the failure
  // banner above the preserved sections so the user can fix + retry without losing it.
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
