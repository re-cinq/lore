// What a finalized feature shows: where its spec landed, the stories it decomposed into, and the draft itself.

import { Alert } from "@/components/Alert";
import CollapsibleCard from "@/components/CollapsibleCard";
import Markdown from "@/components/Markdown";
import DecompositionView from "./DecompositionView";
import type { FeatureWithIterations } from "@/lib/feature-types";
import type { DecompStoryGroup } from "@/lib/decomposition-view";
import styles from "./FeatureDetailView.module.scss";

/** Where the spec landed. A finalized feature whose PR has not appeared yet is still in flight rather than broken, so the absence reads as progress rather than as a missing link. */
function SpecPrCard({ feature }: { feature: FeatureWithIterations }) {
  if (!feature.spec_pr_url) {
    return (
      <div className={`spec-card ${styles.specCard}`}>
        <Alert>Creating the spec PR…</Alert>
      </div>
    );
  }

  return (
    <div className={`spec-card ${styles.specCard}`}>
      <SpecPrLinks feature={feature} />
    </div>
  );
}

/** The spec PR, and the user story beside it when the feature filed one. */
function SpecPrLinks({ feature }: { feature: FeatureWithIterations }) {
  const prUrl = feature.spec_pr_url ?? undefined;

  return (
    <p>
      Spec PR:{" "}
      <a href={prUrl} target="_blank" rel="noreferrer">
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
  );
}

/** The drafted spec, folded away. Collapsed by default with its length as the hint: it is long enough to take the page over, and the reader is usually here for the decomposition above it. */
function DraftSpecCard({ markdown }: { markdown?: string | null }) {
  if (!markdown) {
    return null;
  }

  return (
    <CollapsibleCard
      title="Draft spec"
      hint={`${markdown.split("\n").length} lines`}
    >
      <Markdown markdown={markdown} />
    </CollapsibleCard>
  );
}

interface FinalizedViewProps {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  decomposition: { stories: DecompStoryGroup[]; total: number };
}

export function FinalizedView(props: FinalizedViewProps) {
  const { owner, repo, feature, decomposition } = props;

  return (
    <div>
      <SpecPrCard feature={feature} />
      <DecompositionView
        owner={owner}
        repo={repo}
        stories={decomposition.stories}
        total={decomposition.total}
      />
      <DraftSpecCard markdown={feature.draft_spec_md} />
    </div>
  );
}
