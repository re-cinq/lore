import HelpPopover from '@/components/HelpPopover';
import Markdown from '@/components/Markdown';

/** Fixed budget the runners/`/api/context` route assemble against (faithful). */
export const TOKEN_BUDGET = 8000;

export interface AssembledSection {
  header: string;
  tokens: number;
  truncated: boolean;
}

export interface AssembledResult {
  text: string | null;
  sections?: AssembledSection[];
}

export interface AssembledContextViewProps {
  /** Controlled query value (data down); edits flow up via onQueryChange. */
  query: string;
  /** Controlled template value (data down); edits flow up via onTemplateChange. */
  template: string;
  templates: string[];
  result: AssembledResult | null;
  loading: boolean;
  error: string | null;
  onQueryChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onSubmit: () => void;
}

/**
 * Presentational view for the assembled-context preview. Pure render — the
 * container (`AssembledContextPanel`) owns query/template/fetch state and passes
 * it down; this component renders the form, the per-section token breakdown, and
 * the assembled block, pushing every interaction back up via callback props.
 */
export default function AssembledContextView({
  query,
  template,
  templates,
  result,
  loading,
  error,
  onQueryChange,
  onTemplateChange,
  onSubmit,
}: AssembledContextViewProps) {
  const sections = result?.sections ?? [];
  const total = sections.reduce((sum, s) => sum + s.tokens, 0);
  const canSubmit = query.trim().length > 0 && !loading;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ margin: 0 }}>Assembled Context</h2>
        <HelpPopover label="What sessions receive">
          <p>This is the exact context block a dev session receives on turn 1 — the output of <code>assemble_context</code>, not the raw ingested corpus.</p>
          <ul>
            <li>It is recomputed live against the same <code>/api/context</code> endpoint and {TOKEN_BUDGET}-token budget the task runners use, so the preview matches what a session gets for that query and template.</li>
            <li>Pick the template a task type would use — implementation tasks use <code>implementation</code>, reviews use <code>review</code>.</li>
            <li>Truncated sections were cut to fit the token budget.</li>
          </ul>
        </HelpPopover>
      </div>
      <p className="meta" style={{ marginTop: '6px', marginBottom: '12px' }}>
        The exact context block a dev session receives on turn 1, assembled live for your query and template — not the raw ingested corpus.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}
      >
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Describe the task, like a dev session would…"
          rows={2}
          style={{ width: '100%', resize: 'vertical', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
        />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label htmlFor="template" className="meta">Template</label>
          <select
            id="template"
            value={template}
            onChange={(e) => onTemplateChange(e.target.value)}
            style={{ padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
          >
            {templates.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button type="submit" className="btn" disabled={!canSubmit}>
            {loading ? 'Assembling…' : 'Assemble'}
          </button>
        </div>
      </form>

      {loading && <p className="meta">Assembling context…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Context unavailable: {error}</p>}

      {!loading && !error && result && (
        result.text === null ? (
          <p className="meta">No context assembled — the repo may not be onboarded or ingested yet.</p>
        ) : (
          <div>
            <p className="meta">{total} / {TOKEN_BUDGET} tokens</p>
            {sections.map((s) => (
              <div key={s.header} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600 }}>{s.header}</span>
                  <span className="meta">{s.tokens} tokens</span>
                  {s.truncated && <span className="badge badge-yellow">truncated</span>}
                </div>
                <div style={{ height: '6px', background: 'var(--bg-hover)', borderRadius: 'var(--radius-sm)', marginTop: '3px' }}>
                  <div
                    data-token-bar
                    style={{
                      width: `${Math.min(100, (s.tokens / TOKEN_BUDGET) * 100)}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                </div>
              </div>
            ))}
            <div style={{ marginTop: '12px', padding: '16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <Markdown markdown={result.text} />
            </div>
          </div>
        )
      )}
    </div>
  );
}
