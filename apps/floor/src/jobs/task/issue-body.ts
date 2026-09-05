/** Pure composition of a Lore-managed GitHub issue body; appended *after* the LLM copy pass, which compresses the body and strips trailers. */

import { loreTaskRef } from "../lib/task-ref.js";
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

function renderStatement(s: DriftStatementView): string {
  const where = s.section ? ` _(${s.section})_` : "";
  const links = s.links?.length
    ? ` — ${s.links.map((l) => (l.path ? `${l.label} (${l.path}${l.line ? `#L${l.line}` : ""})` : (l.label ?? ""))).join(", ")}`
    : "";

  return `- [${s.reason ?? "drifted"}]${where} ${s.text ?? ""}${links}`.trimEnd();
}

/** The graph-detected drifted-statements block, or null when the bundle carries none. */
function driftedStatementsBlock(statements: unknown): string | null {
  if (!Array.isArray(statements) || statements.length === 0) {
    return null;
  }
  const list = (statements as DriftStatementView[])
    .map(renderStatement)
    .join("\n");

  return `**Drifted statements (spec-trace graph)**\n\n${list}`;
}

/** The heuristic's missing-top-level-symbols block, or null when the bundle carries none. */
function missingSymbolsBlock(symbols: unknown): string | null {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return null;
  }
  const list = (symbols as MissingSymbolView[])
    .map((s) =>
      `- ${s.kind ?? "symbol"}: \`${s.name ?? ""}\` — ${s.description ?? ""}`.trimEnd(),
    )
    .join("\n");

  return `**Missing symbols (heuristic)**\n\n${list}`;
}

/** Graph-detected statements when present, else the heuristic's missing top-level symbols; empty when neither rode in the bundle. */
function driftDetailBlock(task: IssueComposeTask): string {
  const drifted = driftedStatementsBlock(
    task.context_bundle?.drifted_statements,
  );

  if (drifted) {
    return drifted;
  }

  return missingSymbolsBlock(task.context_bundle?.missing_symbols) ?? "";
}

export function composeIssueBody(
  issueBody: string,
  task: IssueComposeTask,
  uiUrl?: string,
): string {
  const sections = [issueBody];

  if (isDriftTask(task)) {
    const detail = driftDetailBlock(task);

    sections.push(...(detail ? [detail] : []), DRIFT_ISSUE_GUIDANCE);
  }
  const footer = `*Managed by [Lore](https://github.com/re-cinq/lore) · created by \`${task.created_by || "unknown"}\` · Lore-Task: ${loreTaskRef(task.id, uiUrl)}*`;

  return `${sections.join("\n\n")}\n\n---\n${footer}`;
}
