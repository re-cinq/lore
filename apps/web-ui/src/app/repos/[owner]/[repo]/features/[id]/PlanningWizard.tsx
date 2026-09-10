"use client";

import type { ReactNode } from "react";
import { phaseView } from "./planning-phase-view";
import { AnalysisView } from "./AnalysisView";
import {
  analysisProps,
  usePlanningRound,
  type PlanningRound,
} from "./usePlanningRound";
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

export default function PlanningWizard(props: PlanningWizardProps) {
  const round = usePlanningRound(props);
  const phaseCard = phaseCardOf(props, round);

  if (phaseCard) {
    return phaseCard;
  }

  return (
    <AnalysisView
      {...analysisProps(round)}
      handlers={roundHandlers(round, props.onCreateDraft)}
    />
  );
}

/** A card here means the line is between rounds — running, failed, or finished — and there is no analysis to edit yet. */
function phaseCardOf(props: PlanningWizardProps, round: PlanningRound) {
  return phaseView({
    phase: round.phase,
    poll: round.poll,
    settledView: props.settledView,
    iteration: round.iteration,
    timeoutMinutes: props.timeoutMinutes,
    finalizing: round.finalizing,
    latestCreatedAt: round.latestCreatedAt,
  });
}

/** Everything the analysis can send back up: edits to the answers, the two submits, and the rewind choice. */
function roundHandlers(
  round: PlanningRound,
  onCreateDraft: PlanningWizardProps["onCreateDraft"],
) {
  return {
    onChangeFeedback: round.setFeedback,
    onCreateDraft,
    onRefine: round.submitRefine,
    onCreateSpecPr: round.submitCreateSpecFile,
    onContinueFrom: round.setContinueFrom,
  };
}
