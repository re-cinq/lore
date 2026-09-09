"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import type {
  FeatureWithIterations,
  SectionAnswers,
} from "@/lib/feature-types";

export interface PlanningRoundInput {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  onFinalize: (userAnswers: SectionAnswers) => Promise<void>;
}

type PollData = ReturnType<typeof useSeededPoll>["data"];
type LatestIteration = PollData["latestIteration"];
type RoundDraft = ReturnType<typeof useRoundDraft>;
type RoundActions = Pick<PlanningRoundInput, "refine" | "onFinalize">;
type FetchLatest = () => Promise<unknown>;

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
function useRoundStatus(poll: PollData) {
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

  useRefreshWhenRoundLands({
    latestReady,
    iteration: latestIterationOrNull,
  });

  return { latest, phase, latestReady, failed, iteration, latestCreatedAt };
}

/** The wizard's whole state: where the planning line is, what the author has typed, and the two submits. Kept together because each depends on the last — the phase is read from the poll, the round metadata from the phase, and the submits close over the feedback the author is editing. */
export function usePlanningRound(props: PlanningRoundInput) {
  const { feature } = props;
  const { data: poll, refresh: fetchLatest } = useSeededPoll(props);
  const draft = useRoundDraft();
  // Rewind options come from the SERVER-rendered feature, not the poll: the poll carries only the latest iteration, and rewinding needs the history.
  const rounds = rewindOptions(feature.iterations);
  const submits = useRoundSubmits(draft, props, fetchLatest);

  useRefreshWhenPlanningEnds({
    finalizing: draft.finalizing,
    featureStatus: poll.feature.status,
  });

  return {
    ...draft,
    ...useRoundStatus(poll),
    ...submits,
    poll,
    rounds,
    rewinding: isRewind(rounds, draft.continueFrom),
  };
}

export type PlanningRound = ReturnType<typeof usePlanningRound>;

/** True/false plus what stage the current round is in, kept off the component's own body so its optional chains don't count against it. */
function planningRoundStatus(
  latest: LatestIteration,
  phase: ReturnType<typeof featurePhaseOf>,
) {
  return {
    latestReady: latest?.status === "ready" && !!latest.gap_result,
    failed: phase.kind === "failed",
  };
}

/** The round to attribute the current view to, and its timestamps — likewise pulled off the component body. */
function latestRoundMeta(latest: LatestIteration, featureIteration: number) {
  const iteration = latest?.iteration ?? featureIteration;

  return {
    iteration,
    latestIterationOrNull: latest ? iteration : null,
    latestCreatedAt: latest?.created_at,
  };
}

/** The round whose analysis to show: the latest one when it produced a result, otherwise the most recent that did — a failed refine must not hide the analysis before it. */
function resolveGap(
  state: Pick<AnalysisState, "poll" | "latest" | "latestReady">,
) {
  const source = state.latestReady ? state.latest : state.poll.lastReady;

  return source?.gap_result ?? null;
}

interface AnalysisState {
  poll: PollData;
  latest: LatestIteration;
  latestReady: boolean;
  iteration: number;
  failed: boolean;
  pending: boolean;
  feedback: FeedbackState;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  rewinding: boolean;
}

export function analysisProps(state: AnalysisState) {
  const { poll, latest } = state;

  return {
    iteration: state.iteration,
    failed: state.failed,
    gap: resolveGap(state),
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

/** The server render's own answer, used until the first fetch lands. Everything the page could not know is null rather than guessed. */
function seedFrom(feature: FeatureWithIterations) {
  return {
    feature,
    latestIteration: feature.iterations[feature.iterations.length - 1] ?? null,
    task: null,
    liveOutput: null,
    lastReady: null,
    run: null,
  };
}

/** Seeded from the server render so the first paint is not empty; the mount fetch adds the task, run and live output the page could not have. */
function useSeededPoll(input: {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
}) {
  const { owner, repo, feature } = input;

  return useFeaturePlanningPoll({
    owner,
    repo,
    featureId: feature.id,
    initial: seedFrom(feature),
  });
}

/** Refining keeps the round going: it clears the form and the rewind choice, because both belong to the round just submitted. */
function refineSubmitter(
  draft: RoundDraft,
  actions: RoundActions,
  fetchLatest: FetchLatest,
) {
  return () =>
    draft.startTransition(async () => {
      await actions.refine(toUserAnswers(draft.feedback), draft.continueFrom);
      draft.setFeedback(emptyFeedback());
      draft.setContinueFrom(undefined);
      await fetchLatest();
    });
}

/** Finalizing ends planning, so it latches `finalizing` first — that flag is what makes the page refresh once the feature leaves planning. */
function finalizeSubmitter(
  draft: RoundDraft,
  actions: RoundActions,
  fetchLatest: FetchLatest,
) {
  return () =>
    draft.startTransition(async () => {
      draft.setFinalizing(true);
      await actions.onFinalize(toUserAnswers(draft.feedback));
      draft.setFeedback(emptyFeedback());
      await fetchLatest();
    });
}

/** The two ways a round ends. Both carry the same answers, because accepting drops the author's last form input otherwise. */
function useRoundSubmits(
  draft: RoundDraft,
  actions: RoundActions,
  fetchLatest: FetchLatest,
) {
  return {
    submitRefine: refineSubmitter(draft, actions, fetchLatest),
    submitCreateSpecFile: finalizeSubmitter(draft, actions, fetchLatest),
  };
}

/** The draft spec renders from the SERVER's copy, so a landed round shows pre-round data until this refreshes it — once per iteration, since refresh() re-renders the parent. */
function useRefreshWhenRoundLands(round: {
  latestReady: boolean;
  iteration: number | null;
}): void {
  const { latestReady, iteration } = round;
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
function useRefreshWhenPlanningEnds(planning: {
  finalizing: boolean;
  featureStatus: Parameters<typeof isPlanningActive>[0];
}): void {
  const { finalizing, featureStatus } = planning;
  const router = useRouter();

  useEffect(() => {
    if (finalizing && !isPlanningActive(featureStatus)) {
      router.refresh();
    }
  }, [finalizing, featureStatus, router]);
}
