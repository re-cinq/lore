"use client";

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

/** A horizontal used/total bar reused for budget + per-section allocation.
 *  The fill width is the one genuinely dynamic value, kept inline. */
function Bar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  return (
    <div className={styles.bar}>
      <div
        data-token-bar
        className={styles.barFill}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** One per-section trace card: how much budget it got, what status it ended in,
 *  and (expandable) every document that contributed, with provenance. */
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
            {section.items.map((item, i) => (
              <li key={i} className={styles.docItem}>
                {item.content_type && (
                  <span className={badgeClassForType(item.content_type)}>
                    {labelForType(item.content_type)}
                  </span>
                )}
                {item.source_path ? (
                  <a
                    href={`/repos/${owner}/${repo}/context/${encodeURIComponent(item.source_path)}`}
                  >
                    {item.source_path}
                  </a>
                ) : (
                  <span className="meta">{item.text.slice(0, 60)}…</span>
                )}
                <span className="meta">{item.tokens} tok</span>
                {typeof item.score === "number" && (
                  <span className="meta">rel {item.score.toFixed(2)}</span>
                )}
                {item.ingested_at && (
                  <span className="meta">{item.ingested_at.slice(0, 10)}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Prompt-debug view for the assembled-context preview. The container
 * (`AssembledContextPanel`) owns query/template/fetch state; this renders the
 * form, the assembly trace (inputs, budget, per-section provenance), and the
 * final prompt as a nested tag tree.
 */
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
  const trace = result?.trace;

  return (
    <div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Assembled Context</h2>
        <HelpPopover label="Prompt debug view">
          <p>
            This is the exact context block a dev session receives on turn 1 —
            the output of <code>assemble_context</code> — plus a full trace of{" "}
            <em>how and why</em> it was assembled.
          </p>
          <ul>
            <li>
              Each source shows its status, the token budget it was allocated,
              and every document it contributed (with relevance and ingested
              date).
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
      </div>
      <p className={`meta ${styles.lede}`}>
        The turn-1 context block, assembled live for your query and template,
        with a trace of every assembly decision.
      </p>

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

      {loading && <p className="meta">Assembling context…</p>}
      {error && <p className={styles.error}>Context unavailable: {error}</p>}

      {!loading &&
        !error &&
        result &&
        (result.text === null && !trace ? (
          <p className="meta">
            No context assembled — the repo may not be onboarded or ingested
            yet.
          </p>
        ) : trace ? (
          <div>
            {/* Inputs + budget summary */}
            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span className="badge badge-gray">
                  template: {trace.template}
                </span>
                <span className="badge badge-gray">
                  budget: {trace.effectiveBudget}
                </span>
                {trace.crossRepo && (
                  <span className="badge badge-blue">cross-repo</span>
                )}
                {trace.freshness.state !== "fresh" && (
                  <span className="badge badge-yellow">
                    {trace.freshness.state}
                  </span>
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

            {/* Per-section trace */}
            <h3 className={styles.sourcesTitle}>Sources</h3>
            {trace.sections.map((s) => (
              <TraceCard
                key={`${s.header}-${s.source}`}
                owner={owner}
                repo={repo}
                section={s}
              />
            ))}

            {/* Final prompt as nested tag tree */}
            <div className={styles.promptHead}>
              <h3 className={styles.promptTitle}>Assembled prompt</h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRaw((v) => !v)}
              >
                {raw ? "Rendered" : "Raw"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void navigator.clipboard?.writeText(result.text ?? "")
                }
              >
                Copy
              </button>
            </div>
            <TagBox node={buildTagTree(trace)} raw={raw} />
          </div>
        ) : (
          /* Fallback when the trace is unavailable: plain assembled text. */
          <div className={styles.fallback}>
            <Markdown markdown={result.text ?? ""} />
          </div>
        ))}
    </div>
  );
}
