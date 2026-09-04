"use client";

import { Alert } from "@/components/Alert";
import { useState } from "react";
import HelpPopover from "@/components/HelpPopover";
import Markdown from "@/components/Markdown";
import { badgeClassForType, labelForType } from "@/lib/content-types";
import { buildTagTree } from "./tag-tree";
import TagBox from "./TagBox";
import type { AssembledResult, TraceSection } from "./trace-types";
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

/** Status → badge color, so an empty/error section reads at a glance. */
function statusBadgeClass(section: TraceSection): string {
  if (section.included) {
    return section.truncated ? "badge badge-yellow" : "badge badge-green";
  }

  if (section.status === "error") {
    return "badge badge-red";
  }

  return "badge badge-gray";
}

function statusLabel(section: TraceSection): string {
  if (section.included) {
    return section.truncated ? "included · truncated" : "included";
  }

  return `omitted · ${section.omitReason ?? section.status}`;
}

/** Used/total bar for budget + per-section; fill width passed to stylesheet. */
function Bar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  return (
    <div className={styles.bar}>
      <div
        data-token-bar
        className={styles.barFill}
        style={{ ["--fill-width" as string]: `${pct}%` }}
      />
    </div>
  );
}

/** Per-section card: budget, status, documents with provenance (expandable). */
function TraceCard({
  owner,
  repo,
  section,
}: {
  owner: string;
  repo: string;
  section: TraceSection;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{section.header}</span>
        <span className="badge badge-gray">{section.source}</span>
        <span className="meta">P{section.priority}</span>
        <span className={statusBadgeClass(section)}>
          {statusLabel(section)}
        </span>
        <span className={`meta ${styles.spacer}`}>
          {section.finalTokens} / {section.allocatedBudget || section.rawTokens}{" "}
          tok
        </span>
      </div>
      {section.allocatedBudget > 0 && (
        <div className={styles.barWrap}>
          <Bar used={section.finalTokens} total={section.allocatedBudget} />
        </div>
      )}
      {section.items.length > 0 && (
        <details className={styles.docs}>
          <summary className={`meta ${styles.docsSummary}`}>
            {section.items.length} contributing document
            {section.items.length === 1 ? "" : "s"}
          </summary>
          <ul className={styles.docList}>
            {section.items.map((document, i) => (
              <li key={i} className={styles.docItem}>
                {document.content_type && (
                  <span className={badgeClassForType(document.content_type)}>
                    {labelForType(document.content_type)}
                  </span>
                )}
                {document.source_path ? (
                  <a
                    href={`/repos/${owner}/${repo}/context/${encodeURIComponent(document.source_path)}`}
                  >
                    {document.source_path}
                  </a>
                ) : (
                  <span className="meta">{document.text.slice(0, 60)}…</span>
                )}
                <span className="meta">{document.tokens} tok</span>
                {typeof document.score === "number" && (
                  <span className="meta">rel {document.score.toFixed(2)}</span>
                )}
                {document.ingested_at && (
                  <span className="meta">
                    {document.ingested_at.slice(0, 10)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Assembled context view: form + assembly trace + final prompt tree. */
export default function AssembledContextView({
  owner,
  repo,
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
  const [raw, setRaw] = useState(false);
  const canSubmit = query.trim().length > 0 && !loading;

  return (
    <div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Assembled Context</h2>
        <PromptDebugHelp />
      </div>
      <p className={`meta ${styles.lede}`}>
        The turn-1 context block, assembled live for your query and template,
        with a trace of every assembly decision.
      </p>
      <QueryForm
        query={query}
        template={template}
        templates={templates}
        loading={loading}
        canSubmit={canSubmit}
        onQueryChange={onQueryChange}
        onTemplateChange={onTemplateChange}
        onSubmit={onSubmit}
      />
      {loading && <Alert>Assembling context…</Alert>}
      {error && <p className={styles.error}>Context unavailable: {error}</p>}
      {!loading && !error && (
        <AssemblyResult
          owner={owner}
          repo={repo}
          result={result}
          raw={raw}
          onToggleRaw={() => setRaw((v) => !v)}
        />
      )}
    </div>
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
          Omitted sections name their reason (no results, no rule matched,
          budget exhausted).
        </li>
      </ul>
    </HelpPopover>
  );
}

function QueryForm({
  query,
  template,
  templates,
  loading,
  canSubmit,
  onQueryChange,
  onTemplateChange,
  onSubmit,
}: Pick<
  AssembledContextViewProps,
  | "query"
  | "template"
  | "templates"
  | "loading"
  | "onQueryChange"
  | "onTemplateChange"
  | "onSubmit"
> & { canSubmit: boolean }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        if (canSubmit) {
          onSubmit();
        }
      }}
      className={styles.form}
    >
      <textarea
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Describe the task, like a dev session would…"
        rows={2}
        className={styles.textarea}
      />
      <div className={styles.controls}>
        <label htmlFor="template" className="meta">
          Template
        </label>
        <select
          id="template"
          value={template}
          onChange={(e) => onTemplateChange(e.target.value)}
          className={styles.select}
        >
          {templates.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" className="btn" disabled={!canSubmit}>
          {loading ? "Assembling…" : "Assemble"}
        </button>
      </div>
    </form>
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
      <Markdown markdown={result.text ?? ""} />
    </div>
  );
}

/** The assembled block plus the trace of how it got that way; without a trace only the plain text is available, and without either there is nothing to show. */
function AssemblyResult({
  owner,
  repo,
  result,
  raw,
  onToggleRaw,
}: Pick<AssembledContextViewProps, "owner" | "repo" | "result"> & {
  raw: boolean;
  onToggleRaw: () => void;
}) {
  if (!result) {
    return null;
  }

  const trace = result.trace;
  const emptyState = assemblyEmptyState(result, trace);

  if (emptyState || !trace) {
    return emptyState;
  }

  return (
    <div>
      <TraceSummary trace={trace} />
      <TraceSources owner={owner} repo={repo} sections={trace.sections} />
      <AssembledPrompt
        trace={trace}
        text={result.text ?? ""}
        raw={raw}
        onToggleRaw={onToggleRaw}
      />
    </div>
  );
}

/** What the assembly was given and what it spent: template, budget, cross-repo reach, freshness, and how long it took. */
function TraceSummary({
  trace,
}: {
  trace: NonNullable<NonNullable<AssembledContextViewProps["result"]>["trace"]>;
}) {
  return (
    <>
      {/* Inputs + budget summary */}
      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span className="badge badge-gray">template: {trace.template}</span>
          <span className="badge badge-gray">
            budget: {trace.effectiveBudget}
          </span>
          {trace.crossRepo && (
            <span className="badge badge-blue">cross-repo</span>
          )}
          {trace.freshness.state !== "fresh" && (
            <span className="badge badge-yellow">{trace.freshness.state}</span>
          )}
          <span className={`meta ${styles.spacer}`}>
            {trace.timingsMs.total} ms
          </span>
        </div>
        <p className={`meta ${styles.summaryMeta}`}>
          {trace.budget.used} / {trace.budget.total} tokens used ·{" "}
          {trace.budget.leftover} left
        </p>
        <Bar used={trace.budget.used} total={trace.budget.total} />
      </div>
    </>
  );
}

function TraceSources({
  owner,
  repo,
  sections,
}: {
  owner: string;
  repo: string;
  sections: NonNullable<
    NonNullable<AssembledContextViewProps["result"]>["trace"]
  >["sections"];
}) {
  return (
    <>
      <h3 className={styles.sourcesTitle}>Sources</h3>
      {sections.map((s) => (
        <TraceCard
          key={`${s.header}-${s.source}`}
          owner={owner}
          repo={repo}
          section={s}
        />
      ))}
    </>
  );
}

/** The same XML the runners receive, as a nested tag tree — or the raw text, for copying into somewhere that wants it verbatim. */
function AssembledPrompt({
  trace,
  text,
  raw,
  onToggleRaw,
}: {
  trace: NonNullable<NonNullable<AssembledContextViewProps["result"]>["trace"]>;
  text: string;
  raw: boolean;
  onToggleRaw: () => void;
}) {
  return (
    <>
      {/* Final prompt as nested tag tree */}
      <div className={styles.promptHead}>
        <h3 className={styles.promptTitle}>Assembled prompt</h3>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onToggleRaw()}
        >
          {raw ? "Rendered" : "Raw"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          Copy
        </button>
      </div>
      <TagBox node={buildTagTree(trace)} raw={raw} />
    </>
  );
}
