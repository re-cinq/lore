"use client";

import { Alert } from "@/components/Alert";
import Link from "next/link";
import styles from "./FeatureDetailView.module.scss";
import CollapsibleCard from "@/components/CollapsibleCard";
import { DangerZone } from "@/components/DangerZone";
import {
  FeatureAssemblyLine,
  type AssemblyRunSummary,
} from "@/components/FeatureAssemblyLine";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import { featurePhaseOf } from "@/lib/feature-phase";
import { SubmitButton } from "@/components/SubmitButton";
import { useState, useTransition } from "react";
import StatusBadge from "../StatusBadge";
import { isLifecycleActive } from "../feature-status";
import PlanningWizard from "./PlanningWizard";
import DecompositionView from "./DecompositionView";
import Markdown from "@/components/Markdown";
import type {
  FeatureWithIterations,
  SectionAnswers,
} from "@/lib/feature-types";
import type { DecompStoryGroup } from "@/lib/decomposition-view";

function FinalizedView({
  owner,
  repo,
  feature,
  decomposition,
}: {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  decomposition: { stories: DecompStoryGroup[]; total: number };
}) {
  return (
    <div>
      <div className={`spec-card ${styles.specCard}`}>
        {feature.spec_pr_url ? (
          <p>
            Spec PR:{" "}
            <a href={feature.spec_pr_url} target="_blank" rel="noreferrer">
              #{feature.spec_pr_number}
            </a>
            {feature.issue_url && (
              <>
                {" · "}
                <a href={feature.issue_url} target="_blank" rel="noreferrer">
                  user story
                </a>
              </>
            )}
          </p>
        ) : (
          <Alert>Creating the spec PR…</Alert>
        )}
      </div>
      <DecompositionView
        owner={owner}
        repo={repo}
        stories={decomposition.stories}
        total={decomposition.total}
      />
      {feature.draft_spec_md && (
        <CollapsibleCard
          title="Draft spec"
          hint={`${feature.draft_spec_md.split("\n").length} lines`}
        >
          <Markdown markdown={feature.draft_spec_md} />
        </CollapsibleCard>
      )}
    </div>
  );
}

export default function FeatureDetailView({
  owner,
  repo,
  feature,
  timeoutMinutes,
  decomposition,
  definition = null,
  run = null,
  refine,
  onCreateSpecFile,
  split,
  del,
}: {
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
}) {
  const [pending, startTransition] = useTransition();
  const onCreateDraft = (title: string, prompt: string) =>
    startTransition(() => split(title, prompt));
  const base = `/repos/${owner}/${repo}`;
  // Only show live graph below to avoid frozen server-rendered twin when node is working.
  const phase = featurePhaseOf({ run, feature });
  const liveGraphBelow =
    run !== null &&
    (phase.kind === "planning" || phase.kind === "writing-spec");

  return (
    <div>
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

      {liveGraphBelow ? null : (
        <FeatureAssemblyLine
          definition={definition}
          run={run}
          title="This feature's assembly line"
        />
      )}

      {feature.original_prompt && (
        <CollapsibleCard title="Your prompt" defaultOpen>
          <p className={styles.prompt}>{feature.original_prompt}</p>
        </CollapsibleCard>
      )}

      <LifecycleBody
        owner={owner}
        repo={repo}
        feature={feature}
        timeoutMinutes={timeoutMinutes}
        decomposition={decomposition}
        refine={refine}
        onCreateSpecFile={onCreateSpecFile}
        onCreateDraft={onCreateDraft}
      />
      <DeleteFeature
        title={feature.title}
        pending={pending}
        onDelete={() => startTransition(() => del())}
      />
    </div>
  );
}

/** The wizard stays mounted while the lifecycle is still moving — including a merged spec PR awaiting decomposition — because only the line knows when to hand off to the finished view. */
function LifecycleBody({
  owner,
  repo,
  feature,
  timeoutMinutes,
  decomposition,
  refine,
  onCreateSpecFile,
  onCreateDraft,
}: {
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
}) {
  const finalized = (
    <FinalizedView
      owner={owner}
      repo={repo}
      feature={feature}
      decomposition={decomposition}
    />
  );

  if (!isLifecycleActive(feature.status)) {
    return finalized;
  }

  return (
    <PlanningWizard
      owner={owner}
      repo={repo}
      feature={feature}
      timeoutMinutes={timeoutMinutes}
      refine={refine}
      onFinalize={onCreateSpecFile}
      onCreateDraft={onCreateDraft}
      settledView={finalized}
    />
  );
}

/** Two-step by design: a feature carries every planning round it ever ran, and none of that comes back. */
function DeleteFeature({
  title,
  pending,
  onDelete,
}: {
  title: string;
  pending: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <DangerZone description="Permanently delete this feature and all its planning rounds. This cannot be undone.">
      {confirming ? (
        <div className={styles.confirmRow}>
          <span>Delete &ldquo;{title}&rdquo; and all its rounds?</span>
          <SubmitButton
            type="button"
            className="danger"
            onClick={onDelete}
            pending={pending}
            pendingLabel="Deleting…"
          >
            Confirm delete
          </SubmitButton>
          <SubmitButton
            type="button"
            onClick={() => setConfirming(false)}
            pending={pending}
          >
            Cancel
          </SubmitButton>
        </div>
      ) : (
        <SubmitButton
          type="button"
          className="danger"
          onClick={() => setConfirming(true)}
          pending={pending}
        >
          Delete feature
        </SubmitButton>
      )}
    </DangerZone>
  );
}
