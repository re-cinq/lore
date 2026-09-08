"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  emptyFeedback,
  toUserAnswers,
  type FeedbackState,
} from "./GapSections";
import { isPlanningActive } from "@/lib/feature-status";
import { isRewind, rewindOptions } from "@/lib/round-picker";
import { featurePhaseOf } from "@/lib/feature-phase";
import { useFeaturePlanningPoll } from "./useFeaturePlanningPoll";
import { phaseView } from "./planning-phase-view";
import { AnalysisView } from "./AnalysisView";
import type {
  FeatureWithIterations,
  SectionAnswers,
} from "@/lib/feature-types";

interface PlanningWizardProps {
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
}

/** What the author is composing: their answers, which round they are continuing from, and whether a submit is in flight. None of it comes from the server, so a poll landing mid-edit does not disturb it. `continueFrom` undefined means continue from the latest round. */
function useRoundDraft() {
  const [feedback, setFeedback] = useState<FeedbackState>(emptyFeedback());
  const [continueFrom, setContinueFrom] = useState<number | undefined>();
  const [pending, startTransition] = useTransition();
  const [finalizing, setFinalizing] = useState(false);

  return {
    feedback,
    setFeedback,
    continueFrom,
    setContinueFrom,
    pending,
    startTransition,
    finalizing,
    setFinalizing,
  };
}

/** Where the planning line has got to. `phase` is ONE value rather than five booleans: the line says which node is working, and the round's own rows are consulted only for legacy features that predate it. */
function useRoundStatus(poll: ReturnType<typeof useSeededPoll>["data"]) {
  const latest = poll.latestIteration;
  const phase = featurePhaseOf({
    run: poll.run,
    feature: poll.feature,
    latestIteration: latest,
    task: poll.task,
  });
  const { latestReady, failed } = planningRoundStatus(latest, phase);
  const { iteration, latestIterationOrNull, latestCreatedAt } = latestRoundMeta(
    latest,
    poll.feature.current_iteration,
  );

  useRefreshWhenRoundLands(latestReady, latestIterationOrNull);

  return { latest, phase, latestReady, failed, iteration, latestCreatedAt };
}

type PlanningRoundInput = Pick<
  PlanningWizardProps,
  "owner" | "repo" | "feature" | "refine" | "onFinalize"
>;

/** The wizard's whole state: where the planning line is, what the author has typed, and the two submits. Kept together because each depends on the last — the phase is read from the poll, the round metadata from the phase, and the submits close over the feedback the author is editing. */
function usePlanningRound(props: PlanningRoundInput) {
  const { feature } = props;
  const { data: poll, refresh: fetchLatest } = useSeededPoll(
    props.owner,
    props.repo,
    feature,
  );
  const draft = useRoundDraft();
  // Rewind options come from the SERVER-rendered feature, not the poll: the poll carries only the latest iteration, and rewinding needs the history.
  const rounds = rewindOptions(feature.iterations);
  const submits = useRoundSubmits({
    ...draft,
    refine: props.refine,
    onFinalize: props.onFinalize,
    feedback: draft.feedback,
    continueFrom: draft.continueFrom,
    fetchLatest,
  });

  useRefreshWhenPlanningEnds(draft.finalizing, poll.feature.status);

  return {
    ...draft,
    ...useRoundStatus(poll),
    ...submits,
    poll,
    rounds,
    rewinding: isRewind(rounds, draft.continueFrom),
  };
}

export default function PlanningWizard(props: PlanningWizardProps) {
  const { onCreateDraft, settledView } = props;
  const round = usePlanningRound(props);
  // A card here means the line is between rounds — running, failed, or finished — and there is no analysis to edit yet.
  const phaseCard = phaseView({
    phase: round.phase,
    poll: round.poll,
    settledView,
    iteration: round.iteration,
    timeoutMinutes: props.timeoutMinutes,
    finalizing: round.finalizing,
    latestCreatedAt: round.latestCreatedAt,
  });

  if (phaseCard) {
    return phaseCard;
  }

  return (
    <AnalysisView
      {...analysisProps(round)}
      handlers={{
        onChangeFeedback: round.setFeedback,
        onCreateDraft,
        onRefine: round.submitRefine,
        onCreateSpecPr: round.submitCreateSpecFile,
        onContinueFrom: round.setContinueFrom,
      }}
    />
  );
}

/** True/false plus what stage the current round is in, kept off the component's own body so its optional chains don't count against it. */
function planningRoundStatus(
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"],
  phase: ReturnType<typeof featurePhaseOf>,
) {
  return {
    latestReady: latest?.status === "ready" && !!latest.gap_result,
    failed: phase.kind === "failed",
  };
}

/** The round to attribute the current view to, and its timestamps — likewise pulled off the component body. */
function latestRoundMeta(
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"],
  featureIteration: number,
) {
  const iteration = latest?.iteration ?? featureIteration;

  return {
    iteration,
    latestIterationOrNull: latest ? iteration : null,
    latestCreatedAt: latest?.created_at,
  };
}

/** The round whose analysis to show: the latest one when it produced a result, otherwise the most recent that did — a failed refine must not hide the analysis before it. */
function resolveGap(
  latestReady: boolean,
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"],
  poll: ReturnType<typeof useSeededPoll>["data"],
) {
  const source = latestReady ? latest : poll.lastReady;

  return source?.gap_result ?? null;
}

function analysisProps(state: {
  poll: ReturnType<typeof useSeededPoll>["data"];
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"];
  latestReady: boolean;
  iteration: number;
  failed: boolean;
  pending: boolean;
  feedback: FeedbackState;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  rewinding: boolean;
}) {
  const { poll, latest, latestReady } = state;

  return {
    iteration: state.iteration,
    failed: state.failed,
    gap: resolveGap(latestReady, latest, poll),
    failureReason: poll.task?.failure_reason,
    answers: latest?.user_answers,
    run: poll.run,
    pending: state.pending,
    feedback: state.feedback,
    rounds: state.rounds,
    continueFrom: state.continueFrom,
    rewinding: state.rewinding,
  };
}

/** Seeded from the server render so the first paint is not empty; the mount fetch adds the task, run and live output the page could not have. */
function useSeededPoll(
  owner: string,
  repo: string,
  feature: FeatureWithIterations,
) {
  return useFeaturePlanningPoll({
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
}

/** The two ways a round ends. Both carry the same answers, because accepting drops the author's last form input otherwise. */
function useRoundSubmits(ctx: {
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  onFinalize: (userAnswers: SectionAnswers) => Promise<void>;
  feedback: FeedbackState;
  continueFrom: number | undefined;
  fetchLatest: () => Promise<unknown>;
  startTransition: (fn: () => Promise<void>) => void;
  setFeedback: (next: FeedbackState) => void;
  setContinueFrom: (next: number | undefined) => void;
  setFinalizing: (next: boolean) => void;
}) {
  const submitRefine = () =>
    ctx.startTransition(async () => {
      await ctx.refine(toUserAnswers(ctx.feedback), ctx.continueFrom);
      ctx.setFeedback(emptyFeedback());
      ctx.setContinueFrom(undefined);
      await ctx.fetchLatest();
    });
  const submitCreateSpecFile = () =>
    ctx.startTransition(async () => {
      ctx.setFinalizing(true);
      await ctx.onFinalize(toUserAnswers(ctx.feedback));
      ctx.setFeedback(emptyFeedback());
      await ctx.fetchLatest();
    });

  return { submitRefine, submitCreateSpecFile };
}

/** The draft spec renders from the SERVER's copy, so a landed round shows pre-round data until this refreshes it — once per iteration, since refresh() re-renders the parent. */
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

/** Finalize runs async with no intermediate status, so this watches the running poll's payload rather than adding a second interval of its own. */
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
