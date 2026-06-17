'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import GapSections, { emptyFeedback, toUserAnswers, type FeedbackState } from './GapSections';
import type { FeatureWithIterations, FeatureRow, FeatureIterationRow } from '@/lib/feature-types';

const POLL_MS = 4000;

interface Poll {
  feature: FeatureRow;
  latestIteration: FeatureIterationRow | null;
  task?: { status: string; failure_reason: string | null } | null;
  liveOutput?: string | null;
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
  const task = data.task;
  // A planning round is genuinely in flight only while its task is pending/queued/
  // running. If the task has reached a terminal state but the iteration never
  // produced a usable result (failed, or stuck 'running' with no gap_result), that
  // is a failure the user must see + retry — never an endless "analyzing".
  const taskActive = !task || task.status === 'pending' || task.status === 'queued' || task.status === 'running';
  const latestReady = latest?.status === 'ready' && !!latest.gap_result;
  const failed =
    task?.status === 'failed' || latest?.status === 'failed' || (!latestReady && !taskActive);
  const running = (!latest || latest.status === 'running') && !failed;

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
        <p style={{ display: 'flex', alignItems: 'center', margin: 0 }}>
          Analyzing your feature against the project… (round {latest?.iteration ?? data.feature.current_iteration})
          <span className="planning-dots" aria-hidden="true"><span /><span /><span /></span>
        </p>
        <p className="meta">The planning agent is running. This refreshes automatically.</p>
        {data.liveOutput && (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 220,
              overflow: 'auto',
              background: 'var(--bg-elevated, #f6f8fa)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 6,
              padding: 10,
              fontSize: 12,
              marginTop: 8,
            }}
          >
            {data.liveOutput}
          </pre>
        )}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="spec-card">
        <p style={{ color: '#dc2626', fontWeight: 600 }}>
          Planning round {latest?.iteration ?? data.feature.current_iteration} failed.
        </p>
        {!data.task?.failure_reason && (
          <p className="meta">The run finished without producing a result. Retry, or check the agent logs.</p>
        )}
        {data.task?.failure_reason && (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
              overflow: 'auto',
              background: 'var(--bg-elevated, #f6f8fa)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 6,
              padding: 10,
              fontSize: 12,
              margin: '8px 0',
            }}
          >
            {data.task.failure_reason}
          </pre>
        )}
        <button type="button" disabled={pending} onClick={submitRefine}>
          {pending ? 'Retrying…' : 'Retry'}
        </button>
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
