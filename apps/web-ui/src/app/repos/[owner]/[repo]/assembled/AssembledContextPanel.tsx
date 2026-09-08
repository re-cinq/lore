"use client";

import { useState } from "react";
import AssembledContextView, {
  type AssembledResult,
} from "./AssembledContextView";

const TEMPLATES = ["default", "implementation", "review", "research"];

/** Runs one assembly. `debug=1` is what makes the API return the trace — without it the response is just the block, and this page exists to show the decisions behind it. Returns the outcome rather than setting state, so the caller owns when the UI changes. */
async function fetchAssembly({
  owner,
  repo,
  query,
  template,
}: {
  owner: string;
  repo: string;
  query: string;
  template: string;
}): Promise<{ result: AssembledResult | null; error: string | null }> {
  const url = `/api/repos/${owner}/${repo}/context-preview?query=${encodeURIComponent(query)}&template=${encodeURIComponent(template)}&debug=1`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!response.ok) {
      return { result: null, error: `HTTP ${response.status}` };
    }

    return { result: (await response.json()) as AssembledResult, error: null };
  } catch (err) {
    return { result: null, error: (err as Error).message };
  }
}

/** The query being asked and the last answer to it. Defaults to the `implementation` template because that is the one a dev session actually runs — this page exists to show what a real assembly produces. */
function useAssembly(owner: string, repo: string) {
  const [query, setQuery] = useState("");
  const [template, setTemplate] = useState("implementation");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssembledResult | null>(null);
  const assemble = async () => {
    setLoading(true);

    const outcome = await fetchAssembly({ owner, repo, query, template });

    setResult(outcome.result);
    setError(outcome.error);
    setLoading(false);
  };

  return {
    query,
    template,
    result,
    loading,
    error,
    onQueryChange: setQuery,
    onTemplateChange: setTemplate,
    onSubmit: () => void assemble(),
  };
}

/** Assembled context container; fetches via repo-scoped proxy, hands data to view. */
export default function AssembledContextPanel({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const state = useAssembly(owner, repo);

  return (
    <AssembledContextView
      owner={owner}
      repo={repo}
      templates={TEMPLATES}
      {...state}
    />
  );
}
