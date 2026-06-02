import Link from 'next/link';
import CoverageBar, { type CoverageCounts } from '@/components/CoverageBar';

export interface SpecCardData {
  spec_path: string;
  title: string;
  summary: string;
  coverage: CoverageCounts;
  test_count: number;
  last_linked_at: string | null;
  last_linked_by: string | null;
}

/** Render "{N}h ago" / "{N}m ago" / "just now" relative to now(). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Strip the "local:" prefix from an agent_id; return null for cron/webhook. */
function localAgentName(linkedBy: string | null): string | null {
  if (!linkedBy) return null;
  if (linkedBy.startsWith('local:')) return linkedBy.slice('local:'.length);
  return null;
}

export default function SpecCard({
  owner,
  repo,
  spec,
}: {
  owner: string;
  repo: string;
  spec: SpecCardData;
}) {
  const detailHref = `/repos/${owner}/${repo}/specs/${encodeURIComponent(spec.spec_path)}`;
  const agent = localAgentName(spec.last_linked_by);
  const subline = agent && spec.last_linked_at
    ? `linked ${relativeTime(spec.last_linked_at)} by ${agent} (local)`
    : null;

  return (
    <div className="spec-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{spec.title}</h3>
        <Link href={detailHref} className="btn-secondary" style={{ flexShrink: 0 }}>
          Details
        </Link>
      </div>
      <span className="meta" style={{ fontFamily: 'var(--font-mono)' }}>{spec.spec_path}</span>
      {spec.summary && <p style={{ marginTop: 8 }}>{spec.summary}</p>}
      <div style={{ marginTop: 10 }}>
        <CoverageBar coverage={spec.coverage} />
      </div>
      {subline && (
        <div className="meta" style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>
          {subline}
        </div>
      )}
    </div>
  );
}
