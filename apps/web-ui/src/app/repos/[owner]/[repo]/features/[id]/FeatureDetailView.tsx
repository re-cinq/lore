'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import StatusBadge from '../StatusBadge';
import { isPlanningActive } from '../feature-status';
import PlanningWizard from './PlanningWizard';
import Markdown from '@/components/Markdown';
import type { FeatureWithIterations } from '@/lib/feature-types';

function FinalizedView({ feature }: { feature: FeatureWithIterations }) {
  return (
    <div>
      <div className="spec-card" style={{ marginBottom: 12 }}>
        {feature.spec_pr_url ? (
          <p>
            Spec PR:{' '}
            <a href={feature.spec_pr_url} target="_blank" rel="noreferrer">
              #{feature.spec_pr_number}
            </a>
            {feature.issue_url && (
              <>
                {' · '}
                <a href={feature.issue_url} target="_blank" rel="noreferrer">user story</a>
              </>
            )}
          </p>
        ) : (
          <p className="meta">Finalizing — opening the spec PR…</p>
        )}
      </div>
      {feature.draft_spec_md && (
        <div className="spec-card">
          <Markdown markdown={feature.draft_spec_md} />
        </div>
      )}
    </div>
  );
}

export default function FeatureDetailView({
  owner,
  repo,
  feature,
  refine,
  finalize,
  split,
}: {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  refine: (userAnswers: unknown) => Promise<void>;
  finalize: () => Promise<void>;
  split: (title: string, prompt: string) => Promise<void>;
}) {
  const [, startTransition] = useTransition();
  const onCreateDraft = (title: string, prompt: string) =>
    startTransition(() => split(title, prompt));
  const base = `/repos/${owner}/${repo}`;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{feature.title}</h2>
          <StatusBadge status={feature.status} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href={`${base}/graph`} className="meta">View in graph →</Link>
        </div>
      </div>

      {feature.original_prompt && (
        <div className="spec-card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Your prompt</h3>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{feature.original_prompt}</p>
        </div>
      )}

      {isPlanningActive(feature.status) ? (
        <PlanningWizard
          owner={owner}
          repo={repo}
          feature={feature}
          refine={refine}
          finalize={finalize}
          onCreateDraft={onCreateDraft}
        />
      ) : (
        <FinalizedView feature={feature} />
      )}
    </div>
  );
}
