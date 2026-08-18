"use client";

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
          <p className="meta">Creating the spec PR…</p>
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
  finalize,
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
  finalize: () => Promise<void>;
  split: (title: string, prompt: string) => Promise<void>;
  del: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const onCreateDraft = (title: string, prompt: string) =>
    startTransition(() => split(title, prompt));
  const base = `/repos/${owner}/${repo}`;
  // One graph per page. While a node is working, the wizard's RunningCard draws
  // the same line from its own 4s poll; this card is rendered on the server, so
  // leaving both up would put a frozen twin above a live graph.
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

      {/* The wizard stays mounted for as long as the LIFECYCLE is moving, which
          includes an open spec PR: the line is parked on `merged`, and merging it
          resumes the walk into decomposition. Gating on `isPlanningActive` unmounted
          it the moment the PR was stamped, so the awaiting-merge and decomposing
          views were unreachable on a fresh page load. The wizard decides WHEN the
          settled view takes over, because only the line knows. */}
      {isLifecycleActive(feature.status) ? (
        <PlanningWizard
          owner={owner}
          repo={repo}
          feature={feature}
          timeoutMinutes={timeoutMinutes}
          refine={refine}
          finalize={finalize}
          onCreateDraft={onCreateDraft}
          settledView={
            <FinalizedView
              owner={owner}
              repo={repo}
              feature={feature}
              decomposition={decomposition}
            />
          }
        />
      ) : (
        <FinalizedView
          owner={owner}
          repo={repo}
          feature={feature}
          decomposition={decomposition}
        />
      )}

      <DangerZone description="Permanently delete this feature and all its planning rounds. This cannot be undone.">
        {confirmingDelete ? (
          <div className={styles.confirmRow}>
            <span>
              Delete &ldquo;{feature.title}&rdquo; and all its rounds?
            </span>
            <SubmitButton
              type="button"
              className="danger"
              onClick={() => startTransition(() => del())}
              pending={pending}
              pendingLabel="Deleting…"
            >
              Confirm delete
            </SubmitButton>
            <SubmitButton
              type="button"
              onClick={() => setConfirmingDelete(false)}
              pending={pending}
            >
              Cancel
            </SubmitButton>
          </div>
        ) : (
          <SubmitButton
            type="button"
            className="danger"
            onClick={() => setConfirmingDelete(true)}
            pending={pending}
          >
            Delete feature
          </SubmitButton>
        )}
      </DangerZone>
    </div>
  );
}
