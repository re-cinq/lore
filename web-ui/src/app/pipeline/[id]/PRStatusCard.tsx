'use client';

import { useState, useEffect } from 'react';

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

interface PRStatusCardProps {
  taskId: string;
  fallbackPrUrl?: string;
}

export default function PRStatusCard({ taskId, fallbackPrUrl }: PRStatusCardProps) {
  const [prDetails, setPrDetails] = useState<PRDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPRStatus() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/pipeline/${taskId}/pr-status`);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        setPrDetails(data);
      } catch (err: any) {
        console.error('[PRStatusCard] Failed to fetch PR status:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchPRStatus();
  }, [taskId]);

  // Status badge colors and labels
  const getStatusConfig = (status: PRStatus) => {
    switch (status) {
      case 'draft':
        return { color: '#6b7280', label: 'Draft' };
      case 'open':
        return { color: '#059669', label: 'Open' };
      case 'checks-failing':
        return { color: '#dc2626', label: 'Checks Failing' };
      case 'changes-requested':
        return { color: '#d97706', label: 'Changes Requested' };
      case 'approved':
        return { color: '#059669', label: 'Approved' };
      case 'merged':
        return { color: '#7c3aed', label: 'Merged' };
      case 'closed':
        return { color: '#6b7280', label: 'Closed' };
      default:
        return { color: '#6b7280', label: status };
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="spec-card">
        <p><strong>PR Status:</strong> <span className="meta">Loading...</span></p>
        {fallbackPrUrl && (
          <p><strong>PR:</strong> <a href={fallbackPrUrl} target="_blank" rel="noopener noreferrer">{fallbackPrUrl}</a></p>
        )}
      </div>
    );
  }

  // Error state - show fallback with GitHub unavailable message
  if (error || !prDetails) {
    return (
      <div className="spec-card">
        <p><strong>PR Status:</strong> <span style={{color:'#f87171'}}>Status unavailable</span></p>
        {fallbackPrUrl ? (
          <p><strong>PR:</strong> <a href={fallbackPrUrl} target="_blank" rel="noopener noreferrer">{fallbackPrUrl}</a></p>
        ) : (
          <p className="meta">No PR associated with this task</p>
        )}
        <p className="meta" style={{fontSize:'12px'}}>Unable to fetch status from GitHub: {error}</p>
      </div>
    );
  }

  const statusConfig = getStatusConfig(prDetails.computed_status);

  // Calculate check stats
  const passedChecks = prDetails.checks.filter(c => c.conclusion === 'success').length;
  const failedChecks = prDetails.checks.filter(c => c.conclusion === 'failure').length;
  const pendingChecks = prDetails.checks.filter(c => !c.conclusion || c.status === 'in_progress').length;

  // Get review stats
  const approvedReviews = prDetails.reviews.filter(r => r.state === 'APPROVED');
  const changesRequestedReviews = prDetails.reviews.filter(r => r.state === 'CHANGES_REQUESTED');

  return (
    <div className="spec-card">
      <p>
        <strong>PR Status:</strong>
        <span
          className="badge"
          style={{
            backgroundColor: statusConfig.color,
            color: 'white',
            marginLeft: '8px'
          }}
        >
          {statusConfig.label}
        </span>
      </p>

      <p><strong>PR:</strong> <a href={prDetails.html_url} target="_blank" rel="noopener noreferrer">#{prDetails.number} {prDetails.title}</a></p>

      {/* Check results */}
      {prDetails.checks.length > 0 && (
        <p>
          <strong>Checks:</strong>
          {passedChecks > 0 && <span className="badge" style={{backgroundColor:'#059669',color:'white',marginLeft:'8px'}}>✓ {passedChecks}</span>}
          {failedChecks > 0 && <span className="badge" style={{backgroundColor:'#dc2626',color:'white',marginLeft:'8px'}}>✗ {failedChecks}</span>}
          {pendingChecks > 0 && <span className="badge" style={{backgroundColor:'#d97706',color:'white',marginLeft:'8px'}}>⏳ {pendingChecks}</span>}
        </p>
      )}

      {/* Review status */}
      {(approvedReviews.length > 0 || changesRequestedReviews.length > 0) && (
        <p>
          <strong>Reviews:</strong>
          {approvedReviews.length > 0 && (
            <span className="badge" style={{backgroundColor:'#059669',color:'white',marginLeft:'8px'}}>
              ✓ {approvedReviews.map(r => r.user).join(', ')}
            </span>
          )}
          {changesRequestedReviews.length > 0 && (
            <span className="badge" style={{backgroundColor:'#d97706',color:'white',marginLeft:'8px'}}>
              📝 {changesRequestedReviews.map(r => r.user).join(', ')}
            </span>
          )}
        </p>
      )}

      {/* Mergeable status */}
      {prDetails.mergeable !== null && prDetails.computed_status !== 'merged' && prDetails.computed_status !== 'closed' && (
        <p className="meta">
          Mergeable: {prDetails.mergeable ? 'Yes' : 'No (conflicts detected)'}
        </p>
      )}
    </div>
  );
}