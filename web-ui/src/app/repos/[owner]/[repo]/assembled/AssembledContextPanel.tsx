'use client';

import { useState } from 'react';
import AssembledContextView, { type AssembledResult } from './AssembledContextView';

const TEMPLATES = ['default', 'implementation', 'review', 'research'];

/**
 * Container for the assembled-context preview. Owns query/template/fetch state
 * and recomputes the live context block via the repo-scoped proxy route, then
 * hands the data down to the pure `AssembledContextView`.
 */
export default function AssembledContextPanel({ owner, repo }: { owner: string; repo: string }) {
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState('implementation');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssembledResult | null>(null);

  const assemble = async () => {
    setLoading(true);
    try {
      const url = `/api/repos/${owner}/${repo}/context-preview?query=${encodeURIComponent(query)}&template=${encodeURIComponent(template)}&debug=1`;
      const r = await fetch(url);
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        setResult(null);
        return;
      }
      setResult((await r.json()) as AssembledResult);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AssembledContextView
      owner={owner}
      repo={repo}
      query={query}
      template={template}
      templates={TEMPLATES}
      result={result}
      loading={loading}
      error={error}
      onQueryChange={setQuery}
      onTemplateChange={setTemplate}
      onSubmit={assemble}
    />
  );
}
