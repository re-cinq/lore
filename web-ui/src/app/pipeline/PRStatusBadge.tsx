'use client';
import { useEffect, useState } from 'react';

const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280',
  open: '#2563eb',
  'checks-failing': '#dc2626',
  'changes-requested': '#f59e0b',
  approved: '#16a34a',
  merged: '#7c3aed',
  closed: '#374151',
};

export default function PRStatusBadge({ taskId }: { taskId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pipeline/${taskId}/pr-status`)
      .then(r => r.json())
      .then(data => { if (data.computed_status) setStatus(data.computed_status); })
      .catch(() => {/* silent */});
  }, [taskId]);

  if (!status) return null;

  return (
    <span style={{
      background: STATUS_COLORS[status] || '#6b7280',
      color: 'white',
      padding: '1px 7px',
      borderRadius: '10px',
      fontSize: '11px',
      fontWeight: 600,
    }}>
      {status}
    </span>
  );
}
