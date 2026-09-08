"use client";

import Link from "next/link";
import styles from "./FeatureDetailView.module.scss";
import CollapsibleCard from "@/components/CollapsibleCard";
import DeleteFeature from "./DeleteFeature";
import {
  FeatureAssemblyLine,
  type AssemblyRunSummary,
} from "@/components/FeatureAssemblyLine";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import { featurePhaseOf } from "@/lib/feature-phase";
import { useTransition } from "react";
import StatusBadge from "../StatusBadge";
import { isLifecycleActive } from "@/lib/feature-status";
import PlanningWizard from "./PlanningWizard";
import type {
  FeatureWithIterations,
  SectionAnswers,
} from "@/lib/feature-types";
import type { DecompStoryGroup } from "@/lib/decomposition-view";
import { FinalizedView } from "./FinalizedView";

/** Only show the live graph below to avoid a frozen server-rendered twin while a node is working. */
function showsLiveGraphBelow(
  run: AssemblyRunSummary | null,
  feature: FeatureWithIterations,
): boolean {
  if (run === null) {
    return false;
  }

  const phase = featurePhaseOf({ run, feature });

  return phase.kind === "planning" || phase.kind === "writing-spec";
}

interface FeatureDetailViewProps {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  timeoutMinutes: number;
  decomposition: { stories: DecompStoryGroup[]; total: number };
  definition?: AssemblyLineDefinition | null;
  run?: AssemblyRunSummary | null;
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  onCreateSpecFile: (userAnswers: SectionAnswers) => Promise<void>;
  split: (title: string, prompt: string) => Promise<void>;
  del: () => Promise<void>;
}

interface FeatureHeaderProps {
  feature: FeatureDetailViewProps["feature"];
  base: string;
}

function FeatureHeader(props: FeatureHeaderProps) {
  const { feature, base } = props;

  return (
    <div className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{feature.title}</h2>
        <StatusBadge status={feature.status} />
      </div>
      <div className={styles.links}>
        <Link href={`${base}/graph`} className="meta">
          View in graph →
        </Link>
      </div>
    </div>
  );
}

/** What the author asked for, kept open by default: every later round is a response to it. */
function OriginalPrompt({ prompt }: { prompt: string | null }) {
  if (!prompt) {
    return null;
  }

  return (
    <CollapsibleCard title="Your prompt" defaultOpen>
      <p className={styles.prompt}>{prompt}</p>
    </CollapsibleCard>
  );
}

/** The header, the assembly line, and the prompt that started it. The line is omitted when the body below will render a LIVE one — two graphs of the same run, one of them frozen at server-render time, is worse than one. */
function FeatureIntro(props: FeatureDetailViewProps & { base: string }) {
  const { feature, base, definition = null, run = null } = props;

  return (
    <>
      <FeatureHeader feature={feature} base={base} />

      {showsLiveGraphBelow(run ?? null, feature) ? null : (
        <FeatureAssemblyLine
          definition={definition}
          run={run}
          title="This feature's assembly line"
        />
      )}

      <OriginalPrompt prompt={feature.original_prompt} />
    </>
  );
}

export default function FeatureDetailView(props: FeatureDetailViewProps) {
  const { owner, repo, feature } = props;
  const [pending, startTransition] = useTransition();
  const onCreateDraft = (title: string, prompt: string) =>
    startTransition(() => props.split(title, prompt));

  return (
    <div>
      <FeatureIntro {...props} base={`/repos/${owner}/${repo}`} />
      <LifecycleBody {...props} onCreateDraft={onCreateDraft} />
      <DeleteFeature
        title={feature.title}
        pending={pending}
        onDelete={() => startTransition(() => props.del())}
      />
    </div>
  );
}

interface LifecycleBodyProps {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  timeoutMinutes: number;
  decomposition: { stories: DecompStoryGroup[]; total: number };
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  onCreateSpecFile: (userAnswers: SectionAnswers) => Promise<void>;
  onCreateDraft: (title: string, prompt: string) => void;
}

/** The wizard stays mounted while the lifecycle is still moving — including a merged spec PR awaiting decomposition — because only the line knows when to hand off to the finished view. */
function LifecycleBody(props: LifecycleBodyProps) {
  const { owner, repo, feature } = props;
  const finalized = <FinalizedView {...props} />;

  if (!isLifecycleActive(feature.status)) {
    return finalized;
  }

  return (
    <PlanningWizard
      owner={owner}
      repo={repo}
      feature={feature}
      timeoutMinutes={props.timeoutMinutes}
      refine={props.refine}
      onFinalize={props.onCreateSpecFile}
      onCreateDraft={props.onCreateDraft}
      settledView={finalized}
    />
  );
}
