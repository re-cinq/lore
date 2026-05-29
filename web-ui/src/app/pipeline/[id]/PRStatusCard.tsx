'use client';
import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';

type PRStatus =
  | 'draft'
  | 'open'
  | 'checks-failing'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'closed';

interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

const STATUS_COLORS: Record<PRStatus, string> = {
  draft: 'var(--text-muted)',
  open: 'var(--info)',
  'checks-failing': 'var(--danger)',
  'changes-requested': 'var(--warning)',
  approved: 'var(--success)',
  merged: 'var(--accent)',
  closed: 'var(--border-hover)',
};

export default function PRStatusCard({ taskId, prUrl }: { taskId: string; prUrl: string }) {
  const [details, setDetails] = useState<PRDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pipeline/${taskId}/pr-status`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setDetails(data);
      })
      .catch(() => setError('Status unavailable'));
  }, [taskId]);

  if (error) {
    return (
      <div className="spec-card" style={{ marginTop: '12px' }}>
        <strong>PR Status:</strong>{' '}
        <span className="meta">Status unavailable — </span>
        <a href={prUrl} target="_blank">View on GitHub</a>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="spec-card" style={{ marginTop: '12px' }}>
        <strong>PR Status:</strong> <span className="meta">Loading…</span>
      </div>
    );
  }

  const color = STATUS_COLORS[details.computed_status] || 'var(--text-muted)';
  const passingChecks = details.checks.filter(c => c.conclusion === 'success' || c.conclusion === 'skipped').length;
  const failingChecks = details.checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out').length;
  const pendingChecks = details.checks.filter(c => c.status !== 'completed').length;
  const approvals = details.reviews.filter(r => r.state === 'APPROVED');
  const changesRequested = details.reviews.filter(r => r.state === 'CHANGES_REQUESTED');

  return (
    <div className="spec-card" style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <strong>PR Status:</strong>
        <span
          className="status-pill"
          style={{ ['--pill-color' as string]: color, fontSize: '13px' }}
        >
          {details.computed_status}
        </span>
        <a href={details.html_url} target="_blank" style={{ fontSize: '13px' }}>
          #{details.number} {details.title}
        </a>
      </div>

      {details.checks.length > 0 && (
        <div style={{ fontSize: '13px', marginBottom: '4px' }}>
          <strong>Checks:</strong>{' '}
          {passingChecks > 0 && <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Icon name="check" size={13} /> {passingChecks} passing</span>}
          {failingChecks > 0 && <span style={{ color: 'var(--danger)', marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Icon name="error" size={13} /> {failingChecks} failing</span>}
          {pendingChecks > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Icon name="pending" size={13} /> {pendingChecks} pending</span>}
        </div>
      )}

      {(approvals.length > 0 || changesRequested.length > 0) && (
        <div style={{ fontSize: '13px' }}>
          <strong>Reviews:</strong>{' '}
          {approvals.length > 0 && (
            <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <Icon name="check" size={13} /> Approved by {approvals.map(r => r.user).join(', ')}
            </span>
          )}
          {changesRequested.length > 0 && (
            <span style={{ color: 'var(--warning)', marginLeft: '8px' }}>
              Changes requested by {changesRequested.map(r => r.user).join(', ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
