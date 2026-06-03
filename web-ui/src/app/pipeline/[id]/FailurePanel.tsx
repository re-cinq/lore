import Linkified from '@/components/Linkified';

interface FailureDetail {
  step: string;
  category?: string;
  error: string;
  hint?: string;
}

interface FailureMetadata {
  error?: string;
  category?: string;
  hint?: string;
  details?: FailureDetail[];
}

const CATEGORY_LABELS: Record<string, string> = {
  'anthropic-credit': 'Anthropic credit',
  'anthropic-rate-limit': 'Rate limit',
  'github-workflows-permission': 'Workflows permission',
  'github-permission': 'GitHub permission',
  auth: 'Auth',
  unknown: 'Unknown',
};

function categoryLabel(category?: string): string {
  if (!category) return '';
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Renders the structured failure metadata from a failed task_events row
 * (written by the agent's top-level catch) so a failed task can be diagnosed
 * from the UI page alone — category, remediation hint, and per-step breakdown.
 */
export default function FailurePanel({
  metadata,
  repo,
}: {
  metadata: FailureMetadata;
  repo: string;
}) {
  if (!metadata?.error && !metadata?.details?.length) return null;

  return (
    <div className="spec-card" style={{ marginTop: '16px', borderLeft: '3px solid var(--danger)' }}>
      <h3 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--danger)' }}>Failure</span>
        {metadata.category && <span className="badge badge-red">{categoryLabel(metadata.category)}</span>}
      </h3>

      {metadata.error && (
        <p style={{ margin: '0 0 8px 0' }}>
          <Linkified text={metadata.error} repo={repo} />
        </p>
      )}

      {metadata.hint && (
        <p className="meta" style={{ margin: '0 0 8px 0' }}>
          <strong>How to fix:</strong> <Linkified text={metadata.hint} repo={repo} />
        </p>
      )}

      {metadata.details && metadata.details.length > 0 && (
        <div className="memory-list" style={{ marginTop: '8px' }}>
          {metadata.details.map((d, i) => (
            <div key={i} className="version" style={{ marginBottom: '8px' }}>
              <code style={{ fontSize: 'var(--fs-sm)' }}>{d.step}</code>
              {d.category && (
                <span className="badge badge-red" style={{ marginLeft: '8px' }}>
                  {categoryLabel(d.category)}
                </span>
              )}
              <p style={{ margin: '4px 0 0 0', fontSize: 'var(--fs-sm)' }}>
                <Linkified text={d.error} repo={repo} />
              </p>
              {d.hint && (
                <p className="meta" style={{ margin: '2px 0 0 0', fontSize: 'var(--fs-xs)' }}>
                  {d.hint}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
