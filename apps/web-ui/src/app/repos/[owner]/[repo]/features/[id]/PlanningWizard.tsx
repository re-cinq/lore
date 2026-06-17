'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import GapSections, { emptyFeedback, toUserAnswers, type FeedbackState } from './GapSections';
import type { FeatureWithIterations, FeatureRow, FeatureIterationRow } from '@/lib/feature-types';

const POLL_MS = 4000;

interface Poll {
  feature: FeatureRow;
  latestIteration: FeatureIterationRow | null;
}

export default function PlanningWizard({
  owner,
  repo,
  feature,
  refine,
  finalize,
  onCreateDraft,
}: {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  refine: (userAnswers: unknown) => Promise<void>;
  finalize: () => Promise<void>;
  onCreateDraft: (title: string, prompt: string) => void;
}) {
  const [data, setData] = useState<Poll>({
    feature,
    latestIteration: feature.iterations[feature.iterations.length - 1] ?? null,
  });
  const [feedback, setFeedback] = useState<FeedbackState>(emptyFeedback());
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLatest = useCallback(async () => {
    const r = await fetch(`/api/repos/${owner}/${repo}/features/${feature.id}`, { cache: 'no-store' });
    if (!r.ok) return;
    const json = (await r.json()) as Poll;
    setData(json);
  }, [owner, repo, feature.id]);

  const latest = data.latestIteration;
  const running = !latest || latest.status === 'running';

  useEffect(() => {
    if (!running) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    fetchLatest();
    timer.current = setInterval(fetchLatest, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running, fetchLatest]);

  const submitRefine = () =>
    startTransition(async () => {
      await refine(toUserAnswers(feedback));
      setFeedback(emptyFeedback());
      await fetchLatest();
    });

  const submitFinalize = () => startTransition(() => finalize());

  if (running) {
    return (
      <div className="spec-card">
        <p>Analyzing your feature against the project… (round {latest?.iteration ?? data.feature.current_iteration})</p>
        <p className="meta">A planning Station is running. This refreshes automatically.</p>
      </div>
    );
  }

  if (latest?.status === 'failed') {
    return (
      <div className="spec-card">
        <p style={{ color: '#dc2626' }}>Planning round {latest.iteration} failed.</p>
        <button type="button" disabled={pending} onClick={submitRefine}>Try again</button>
      </div>
    );
  }

  const gap = latest?.gap_result;
  if (!gap) {
    return <div className="spec-card"><p className="meta">No analysis yet.</p></div>;
  }

  return (
    <div>
      <GapSections gap={gap} feedback={feedback} onChange={setFeedback} onCreateDraft={onCreateDraft} />
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="button" disabled={pending} onClick={submitRefine}>
          {pending ? 'Working…' : 'Refine again'}
        </button>
        <button type="button" className="button" disabled={pending} onClick={submitFinalize}>
          Proceed &amp; finalize
        </button>
      </div>
    </div>
  );
}
