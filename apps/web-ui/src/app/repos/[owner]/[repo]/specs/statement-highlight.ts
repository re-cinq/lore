// v3: the rehype plugin that wraps rendered statements in <mark> by test-link state; inline formatting falls back gracefully.

import type { Root, Text, Element, ElementContent, RootContent } from "hast";
import type { StatementState } from "./SpecDetails";

/** Index just past the statement's real content, skipping trailing whitespace/periods. */
function trailingContentEnd(statementText: string): number {
  let end = statementText.length;

  while (end > 0 && /[\s.]/.test(statementText[end - 1])) {
    end--;
  }

  return end;
}

/** Index of the `(` that opens the trailing parenthetical ending at `end`, or null when unbalanced. */
function trailingParenStart(statementText: string, end: number): number | null {
  let depth = 1;

  for (let i = end - 2; i >= 0; i--) {
    const c = statementText[i];

    if (c === ")") {
      depth++;
      continue;
    }

    if (c !== "(") {
      continue;
    }
    depth--;

    if (depth > 0) {
      continue;
    }

    return i;
  }

  return null;
}

/** Strip trailing paren when react-markdown breaks test-link into `<a>` element. */
function matcherText(statementText: string): string {
  const end = trailingContentEnd(statementText);

  if (end === 0 || statementText[end - 1] !== ")") {
    return statementText.trim();
  }

  const start = trailingParenStart(statementText, end);

  if (start === null) {
    return statementText.trim();
  }

  const inner = statementText.slice(start + 1, end - 1);

  return /\[[^\]]+\]\([^)]+\)/.test(inner)
    ? statementText.slice(0, start).trim()
    : statementText.trim();
}

/** Markdown to plain text: collapse links, strip emphasis outside code, keep code spans verbatim. */
function plainText(statementText: string): string {
  return matcherText(statementText)
    .split(/(`[^`]*`)/)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`")
        ? part.slice(1, -1)
        : part
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1"),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rendered text of HAST node and descendants, whitespace-collapsed. */
function renderedText(node: ElementContent | RootContent): string {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type === "element") {
    const { children } = node;

    return children.map(renderedText).join("");
  }

  return "";
}

/** Per-statement facets (ordinal, state, drifted) bundled to avoid positional args at call sites. */
interface MarkMeta {
  ordinal: number;
  state: StatementState;
  drifted?: boolean;
}

/** The statements to highlight, longest matcher first (so a longer statement claims its text before a shorter one that is a prefix of it), plus the set already claimed in this pass. */
interface HighlightState {
  ordered: {
    ordinal: number;
    text: string;
    matcher: string;
    plain: string;
    state: StatementState;
    drifted?: boolean;
  }[];
  used: Set<number>;
}

function markProps(meta: MarkMeta) {
  return {
    className: [
      "stmt",
      `stmt-${meta.state}`,
      ...(meta.drifted ? ["stmt-drifted"] : []),
    ],
    dataOrdinal: String(meta.ordinal),
    dataState: meta.state,
    ...(meta.drifted ? { dataDrifted: "true" } : {}),
  };
}

function makeMark(text: string, meta: MarkMeta): Element {
  return {
    type: "element",
    tagName: "mark",
    properties: markProps(meta),
    children: [{ type: "text", value: text }],
  };
}

function isMatchableBlock(node: Element): boolean {
  return node.tagName === "p" || node.tagName === "li";
}

function hasChildren(node: Element): boolean {
  return node.children.length > 0;
}

function isBlockMatchCandidate(
  state: HighlightState,
  s: HighlightState["ordered"][number],
): boolean {
  return !state.used.has(s.ordinal) && !!s.plain;
}

/** Wrap everything the element already renders in one `<mark>`, keeping its inline structure intact underneath. */
function wrapChildren(node: Element, meta: MarkMeta): void {
  const mark: Element = {
    type: "element",
    tagName: "mark",
    properties: markProps(meta),
    children: node.children,
  };

  node.children = [mark];
}

/** Fallback: wrap element's children when its rendered text matches a statement (split by code/bold). */
function tryBlockMatch(state: HighlightState, node: Element): boolean {
  if (!isMatchableBlock(node) || !hasChildren(node)) {
    return false;
  }
  const rendered = renderedText(node).replace(/\s+/g, " ").trim();

  for (const s of state.ordered) {
    if (!isBlockMatchCandidate(state, s)) {
      continue;
    }

    if (rendered.startsWith(s.plain)) {
      state.used.add(s.ordinal);
      wrapChildren(node, s);

      return true;
    }
  }

  return false;
}

function splitAroundMatch(
  state: HighlightState,
  node: Text,
  idx: number,
  s: HighlightState["ordered"][number],
): ElementContent[] {
  state.used.add(s.ordinal);
  const before = node.value.slice(0, idx);
  const after = node.value.slice(idx + s.matcher.length);
  const parts: ElementContent[] = [];

  if (before) {
    parts.push({ type: "text", value: before });
  }
  parts.push(makeMark(s.matcher, s));

  if (after) {
    parts.push(...tailParts(state, after));
  }

  return parts;
}

/** The text following a match, re-offered to the matcher: a single text node can hold two consecutive statements. */
function tailParts(state: HighlightState, after: string): ElementContent[] {
  const tail = { type: "text", value: after } as Text;

  return processTextNode(state, tail) ?? [tail];
}

function processTextNode(
  state: HighlightState,
  node: Text,
): ElementContent[] | null {
  for (const s of state.ordered) {
    if (state.used.has(s.ordinal)) {
      continue;
    }
    const idx = node.value.indexOf(s.matcher);

    if (idx < 0) {
      continue;
    }

    return splitAroundMatch(state, node, idx, s);
  }

  return null;
}

/** Appends `child` to `out`, replaced by its marked-up parts when a statement claims its text; says whether it was replaced. */
function pushChild<T extends ElementContent | RootContent>(
  state: HighlightState,
  out: T[],
  child: T,
): boolean {
  if (child.type !== "text") {
    out.push(child);

    return false;
  }
  const replaced = processTextNode(state, child);

  if (!replaced) {
    out.push(child);

    return false;
  }
  out.push(...(replaced as T[]));

  return true;
}

/** Recurse into an element child, leaving an existing `<mark>` alone so a second pass cannot nest highlights. */
function descendElement(state: HighlightState, child: ElementContent) {
  if (child.type === "element" && child.tagName !== "mark") {
    walkElement(state, child);
  }
}

/** The element's children after every claimed text node has been replaced by its marked-up parts, and whether any were. */
function rebuildChildren(state: HighlightState, children: ElementContent[]) {
  const next: ElementContent[] = [];
  let changed = false;

  for (const child of children) {
    descendElement(state, child);
    changed = pushChild(state, next, child) || changed;
  }

  return { next, changed };
}

function walkElement(state: HighlightState, node: Element) {
  if (node.children.length === 0) {
    return;
  }
  const { next, changed } = rebuildChildren(state, node.children);

  if (changed) {
    node.children = next;
  }

  // Fallback: whole-element wrap when contiguous-text-node match finds nothing (e.g. fragmented by inline code).
  if (!changed) {
    tryBlockMatch(state, node);
  }
}

/** One statement as the caller knows it, before the matcher texts are derived from it. */
export interface HighlightStatement {
  ordinal: number;
  text: string;
  state: StatementState;
  drifted?: boolean;
}

/** The statements to match, longest matcher first. Order matters: a short statement that is a prefix of a longer one would otherwise claim the longer one's text, and the `used` set makes each claim exclusive. */
function matcherState(statements: HighlightStatement[]): HighlightState {
  const enriched = statements.map((s) => ({
    ordinal: s.ordinal,
    text: s.text,
    matcher: matcherText(s.text) || s.text,
    plain: plainText(s.text),
    state: s.state,
    drifted: s.drifted,
  }));

  return {
    ordered: [...enriched].sort((a, b) => b.matcher.length - a.matcher.length),
    used: new Set<number>(),
  };
}

/** Walks the tree's top level, replacing text nodes whose content a statement claims. Elements recurse through `walkElement`; only the root's own text children are rebuilt here. */
function walkRoot(state: HighlightState, tree: Root) {
  const rootChildren: RootContent[] = [];
  let rootChanged = false;

  for (const child of tree.children) {
    if (child.type === "element") {
      walkElement(state, child);
    }
    rootChanged = pushChild(state, rootChildren, child) || rootChanged;
  }

  return { rootChildren, rootChanged };
}

export function buildHighlighter(statements: HighlightStatement[]) {
  const state = matcherState(statements);

  return function plugin() {
    return function transformer(tree: Root) {
      // react-markdown re-runs on every render with a fresh tree; clearing avoids statements staying claimed from the previous pass.
      state.used.clear();
      const { rootChildren, rootChanged } = walkRoot(state, tree);

      if (rootChanged) {
        tree.children = rootChildren;
      }
    };
  };
}
