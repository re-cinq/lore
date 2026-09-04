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

  if (node.type === "element" && node.children) {
    return node.children.map(renderedText).join("");
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

function hasNoChildren(node: Element): boolean {
  return !node.children || node.children.length === 0;
}

function isBlockMatchCandidate(
  state: HighlightState,
  s: HighlightState["ordered"][number],
): boolean {
  return !state.used.has(s.ordinal) && !!s.plain;
}

/** Fallback: wrap element's children when its rendered text matches a statement (split by code/bold). */
function tryBlockMatch(state: HighlightState, node: Element): boolean {
  if (!isMatchableBlock(node) || hasNoChildren(node)) {
    return false;
  }
  const rendered = renderedText(node).replace(/\s+/g, " ").trim();

  for (const s of state.ordered) {
    if (!isBlockMatchCandidate(state, s)) {
      continue;
    }

    if (rendered.startsWith(s.plain)) {
      state.used.add(s.ordinal);
      node.children = [
        {
          type: "element",
          tagName: "mark",
          properties: markProps(s),
          children: node.children,
        },
      ];

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
    const tail = { type: "text", value: after } as Text;
    const recursed = processTextNode(state, tail);

    parts.push(...(recursed ?? [tail]));
  }

  return parts;
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

function walkElement(state: HighlightState, node: Element) {
  if (!node.children || node.children.length === 0) {
    return;
  }
  const next: ElementContent[] = [];
  let changed = false;

  node.children.forEach((child) => {
    if (child.type === "element" && child.tagName !== "mark") {
      walkElement(state, child);
    }

    if (child.type !== "text") {
      next.push(child);

      return;
    }
    const replaced = processTextNode(state, child);

    if (replaced) {
      next.push(...replaced);
      changed = true;

      return;
    }
    next.push(child);
  });

  if (changed) {
    node.children = next;
  }

  // Fallback: whole-element wrap when contiguous-text-node match finds nothing (e.g. fragmented by inline code).
  if (!changed) {
    tryBlockMatch(state, node);
  }
}

export function buildHighlighter(
  statements: {
    ordinal: number;
    text: string;
    state: StatementState;
    drifted?: boolean;
  }[],
) {
  const enriched = statements.map((s) => ({
    ordinal: s.ordinal,
    text: s.text,
    matcher: matcherText(s.text) || s.text,
    plain: plainText(s.text),
    state: s.state,
    drifted: s.drifted,
  }));
  const state: HighlightState = {
    ordered: [...enriched].sort((a, b) => b.matcher.length - a.matcher.length),
    used: new Set<number>(),
  };

  return function plugin() {
    return function transformer(tree: Root) {
      // react-markdown re-runs on every render with fresh tree; clear matcher state to avoid re-claimed statements.
      state.used.clear();
      const rootChildren: RootContent[] = [];
      let rootChanged = false;

      tree.children.forEach((child) => {
        if (child.type === "element") {
          walkElement(state, child);
        }

        if (child.type !== "text") {
          rootChildren.push(child);

          return;
        }
        const replaced = processTextNode(state, child);

        if (replaced) {
          rootChildren.push(...(replaced as RootContent[]));
          rootChanged = true;

          return;
        }
        rootChildren.push(child);
      });

      if (rootChanged) {
        tree.children = rootChildren;
      }
    };
  };
}
