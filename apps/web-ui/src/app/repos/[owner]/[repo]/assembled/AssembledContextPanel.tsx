"use client";

import { useState } from "react";
import AssembledContextView, {
  type AssembledResult,
} from "./AssembledContextView";

const TEMPLATES = ["default", "implementation", "review", "research"];

interface AssemblyRequest {
  owner: string;
  repo: string;
  query: string;
  template: string;
}

interface AssemblyOutcome {
  result: AssembledResult | null;
  error: string | null;
}

interface AssemblySetters {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (result: AssembledResult | null) => void;
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

/** The query being asked and the last answer to it. */
function useAssembly(owner: string, repo: string) {
  const { query, template, ...controls } = useAssemblyRequest();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssembledResult | null>(null);
  const onSubmit = () =>
    void runAssembly(
      { owner, repo, query, template },
      { setLoading, setError, setResult },
    );

  return { query, template, ...controls, result, loading, error, onSubmit };
}

/** Defaults to the `implementation` template because that is the one a dev session actually runs — this page exists to show what a real assembly produces. */
function useAssemblyRequest() {
  const [query, setQuery] = useState("");
  const [template, setTemplate] = useState("implementation");

  return {
    query,
    template,
    onQueryChange: setQuery,
    onTemplateChange: setTemplate,
  };
}

/** Drives one assembly through the caller's state setters, so the hook stays a wiring layer. */
async function runAssembly(
  request: AssemblyRequest,
  { setLoading, setError, setResult }: AssemblySetters,
) {
  setLoading(true);

  const outcome = await fetchAssembly(request);

  setResult(outcome.result);
  setError(outcome.error);
  setLoading(false);
}

/** Runs one assembly, returning the outcome rather than setting state, so the caller owns when the UI changes. */
async function fetchAssembly(
  request: AssemblyRequest,
): Promise<AssemblyOutcome> {
  try {
    const response = await fetch(contextPreviewUrl(request), {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { result: null, error: `HTTP ${response.status}` };
    }

    return { result: (await response.json()) as AssembledResult, error: null };
  } catch (err) {
    return { result: null, error: (err as Error).message };
  }
}

/** `debug=1` is what makes the API return the trace — without it the response is just the block, and this page exists to show the decisions behind it. */
function contextPreviewUrl({ owner, repo, query, template }: AssemblyRequest) {
  const params = `query=${encodeURIComponent(query)}&template=${encodeURIComponent(template)}`;

  return `/api/repos/${owner}/${repo}/context-preview?${params}&debug=1`;
}
