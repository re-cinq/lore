"use client";

import { Alert } from "@/components/Alert";
import { useState } from "react";
import HelpPopover from "@/components/HelpPopover";
import Markdown from "@/components/Markdown";
import AssemblyQueryForm from "./AssemblyQueryForm";
import { Bar } from "./TraceCard";
import { AssembledPrompt, TraceSources } from "./TracePromptView";
import type { AssembledResult } from "./trace-types";
import styles from "./AssembledContextView.module.css";

export type { AssembledResult } from "./trace-types";

/** Fixed budget the runners/`/api/context` route assemble against (faithful). */
export const TOKEN_BUDGET = 8000;

export interface AssembledContextViewProps {
  owner: string;
  repo: string;
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

/** Assembled context view: form + assembly trace + final prompt tree. */
export default function AssembledContextView(props: AssembledContextViewProps) {
  const { owner, repo, result, loading, error, query } = props;
  const canSubmit = query.trim().length > 0 && !loading;

  return (
    <div>
      <AssembledHeader />
      <AssemblyQueryForm {...props} canSubmit={canSubmit} />
      {loading && <Alert>Assembling context…</Alert>}
      {error && <p className={styles.error}>Context unavailable: {error}</p>}
      {!loading && !error && (
        <AssemblyOutcome owner={owner} repo={repo} result={result} />
      )}
    </div>
  );
}

/** What this page shows and when it was assembled. States "turn-1" explicitly: this is the block a session starts with, not what it accumulates. */
function AssembledHeader() {
  return (
    <>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Assembled Context</h2>
        <PromptDebugHelp />
      </div>
      <p className={`meta ${styles.lede}`}>
        The turn-1 context block, assembled live for your query and template,
        with a trace of every assembly decision.
      </p>
    </>
  );
}

function PromptDebugHelp() {
  return (
    <HelpPopover label="Prompt debug view">
      <p>
        This is the exact context block a dev session receives on turn 1 — the
        output of <code>assemble_context</code> — plus a full trace of{" "}
        <em>how and why</em> it was assembled.
      </p>
      <PromptDebugPoints />
    </HelpPopover>
  );
}

function PromptDebugPoints() {
  return (
    <ul>
      <li>
        Each source shows its status, the token budget it was allocated, and
        every document it contributed (with relevance and ingested date).
      </li>
      <li>
        The final prompt is shown as a nested tag tree — the same XML the
        runners receive.
      </li>
      <li>
        Omitted sections name their reason (no results, no rule matched, budget
        exhausted).
      </li>
    </ul>
  );
}

type AssemblyOutcomeProps = Pick<
  AssembledContextViewProps,
  "owner" | "repo" | "result"
>;

/** Owns the raw/rendered toggle: it is a reading preference of the result, and nothing the query form needs to know about. */
function AssemblyOutcome({ owner, repo, result }: AssemblyOutcomeProps) {
  const [raw, setRaw] = useState(false);

  return (
    <AssemblyResult
      owner={owner}
      repo={repo}
      result={result}
      raw={raw}
      onToggleRaw={() => setRaw((v) => !v)}
    />
  );
}

type AssemblyResultProps = AssemblyOutcomeProps & {
  raw: boolean;
  onToggleRaw: () => void;
};

/** The assembled block plus the trace of how it got that way; without a trace only the plain text is available, and without either there is nothing to show. */
function AssemblyResult(props: AssemblyResultProps) {
  const { result } = props;

  if (!result) {
    return null;
  }

  const trace = result.trace;
  const emptyState = assemblyEmptyState(result, trace);

  if (emptyState || !trace) {
    return emptyState;
  }

  return <TraceView {...props} trace={trace} />;
}

type TraceViewProps = AssemblyResultProps & { trace: AssemblyTrace };

function TraceView({ trace, ...props }: TraceViewProps) {
  const { owner, repo, result } = props;

  return (
    <div>
      <TraceOverview owner={owner} repo={repo} trace={trace} />
      <AssembledPrompt
        trace={trace}
        text={result?.text ?? ""}
        raw={props.raw}
        onToggleRaw={props.onToggleRaw}
      />
    </div>
  );
}

type TraceOverviewProps = Pick<AssemblyOutcomeProps, "owner" | "repo"> & {
  trace: AssemblyTrace;
};

/** The assembly's inputs and the sources it drew on — everything upstream of the prompt itself. */
function TraceOverview({ owner, repo, trace }: TraceOverviewProps) {
  return (
    <>
      <TraceSummary trace={trace} />
      <TraceSources owner={owner} repo={repo} sections={trace.sections} />
    </>
  );
}

/** Empty/fallback rendering when there is no trace to walk through: nothing assembled, or plain text with no trace. */
function assemblyEmptyState(
  result: NonNullable<AssembledContextViewProps["result"]>,
  trace: NonNullable<AssembledContextViewProps["result"]>["trace"],
) {
  if (trace) {
    return null;
  }

  if (result.text === null) {
    return (
      <Alert variant="secondary">
        No context assembled — the repo may not be onboarded or ingested yet.
      </Alert>
    );
  }

  /* Fallback when the trace is unavailable: plain assembled text. */
  return (
    <div className={styles.fallback}>
      <Markdown markdown={result.text} />
    </div>
  );
}

type AssemblyTrace = NonNullable<
  NonNullable<AssembledContextViewProps["result"]>["trace"]
>;

/** What the assembly was given and what it spent: template, budget, cross-repo reach, freshness, and how long it took. */
function TraceSummary({ trace }: { trace: AssemblyTrace }) {
  return (
    <div className={styles.summary}>
      <TraceBadges trace={trace} />
      <p className={`meta ${styles.summaryMeta}`}>
        {trace.budget.used} / {trace.budget.total} tokens used ·{" "}
        {trace.budget.leftover} left
      </p>
      <Bar used={trace.budget.used} total={trace.budget.total} />
    </div>
  );
}

/** The assembly's inputs at a glance. Cross-repo and staleness show only when they APPLY — a badge saying "fresh" on every assembly teaches the reader to stop looking at the row. */
function TraceBadges({ trace }: { trace: AssemblyTrace }) {
  return (
    <div className={styles.summaryRow}>
      <span className="badge badge-gray">template: {trace.template}</span>
      <span className="badge badge-gray">budget: {trace.effectiveBudget}</span>
      {trace.crossRepo && <span className="badge badge-blue">cross-repo</span>}
      {trace.freshness.state !== "fresh" && (
        <span className="badge badge-yellow">{trace.freshness.state}</span>
      )}
      <span className={`meta ${styles.spacer}`}>
        {trace.timingsMs.total} ms
      </span>
    </div>
  );
}
