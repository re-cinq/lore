/**
 * Pure composition of a Lore-managed GitHub issue body: the LLM copy, an
 * optional graph-drift detail block + static remediation guidance for drift
 * tasks, and the provenance footer with a clickable Lore-Task link. Kept pure so
 * it's testable without touching GitHub, and appended *after* the LLM copy pass
 * (which compresses the body and strips trailers).
 */

import {
  isDriftTask,
  DRIFT_ISSUE_GUIDANCE,
  type DriftTaskLike,
} from "../spec-trace/spec-drift/drift-issue-guidance.js";

export interface IssueComposeTask extends DriftTaskLike {
  id: string;
  created_by?: string | null;
}

interface DriftLinkView {
  label?: string;
  path?: string;
  line?: number;
}

interface DriftStatementView {
  text?: string;
  reason?: string;
  section?: string;
  links?: DriftLinkView[];
}

interface MissingSymbolView {
  name?: string;
  kind?: string;
  description?: string;
}

/** Render the Lore-Task trailer as a link to the deployed task page, or bare. */
export function loreTaskRef(taskId: string, uiUrl?: string): string {
  if (!uiUrl) {
    return taskId;
  }

  return `[${taskId}](${uiUrl.replace(/\/+$/, "")}/assembly-lines/${taskId})`;
}

function renderStatement(s: DriftStatementView): string {
  const where = s.section ? ` _(${s.section})_` : "";
  const links = s.links?.length
    ? ` — ${s.links.map((l) => (l.path ? `${l.label} (${l.path}${l.line ? `#L${l.line}` : ""})` : (l.label ?? ""))).join(", ")}`
    : "";

  return `- [${s.reason ?? "drifted"}]${where} ${s.text ?? ""}${links}`.trimEnd();
}

/**
 * The structured drift detail for the issue body: graph-detected statements
 * (with their validated-by links) when present, else the heuristic's missing
 * top-level symbols. Empty when neither rode in the bundle.
 */
function driftDetailBlock(task: IssueComposeTask): string {
  const statements = task.context_bundle?.drifted_statements;

  if (Array.isArray(statements) && statements.length > 0) {
    const list = (statements as DriftStatementView[])
      .map(renderStatement)
      .join("\n");

    return `**Drifted statements (spec-trace graph)**\n\n${list}`;
  }
  const symbols = task.context_bundle?.missing_symbols;

  if (Array.isArray(symbols) && symbols.length > 0) {
    const list = (symbols as MissingSymbolView[])
      .map((s) =>
        `- ${s.kind ?? "symbol"}: \`${s.name ?? ""}\` — ${s.description ?? ""}`.trimEnd(),
      )
      .join("\n");

    return `**Missing symbols (heuristic)**\n\n${list}`;
  }

  return "";
}

export function composeIssueBody(
  issueBody: string,
  task: IssueComposeTask,
  uiUrl?: string,
): string {
  const sections = [issueBody];

  if (isDriftTask(task)) {
    const detail = driftDetailBlock(task);

    if (detail) {
      sections.push(detail);
    }
    sections.push(DRIFT_ISSUE_GUIDANCE);
  }
  const footer = `*Managed by [Lore](https://github.com/re-cinq/lore) · created by \`${task.created_by || "unknown"}\` · Lore-Task: ${loreTaskRef(task.id, uiUrl)}*`;

  return `${sections.join("\n\n")}\n\n---\n${footer}`;
}
