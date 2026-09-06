/** Symbol name/type extraction for chunker.ts's AST-based chunking: names and classifies a top-level declaration node. */

import type Parser from "web-tree-sitter";

/** Ordered rule table for `inferSymbolType`: first matching predicate wins. */
const SYMBOL_TYPE_RULES: [(nodeType: string) => boolean, string][] = [
  [(t) => t.includes("function") || t === "method_declaration", "function"],
  [(t) => t.includes("class"), "class"],
  [(t) => t.includes("method"), "method"],
  [(t) => t.includes("interface"), "interface"],
  [(t) => t.includes("type_alias") || t === "type_declaration", "type"],
  [(t) => t.includes("enum"), "type"],
  [(t) => t === "export_statement", "export"],
  // decorated_definition could be a class too, refined by refineSymbolType.
  [(t) => t === "decorated_definition", "function"],
];

function inferSymbolType(nodeType: string): string {
  const rule = SYMBOL_TYPE_RULES.find(([matches]) => matches(nodeType));

  return rule ? rule[1] : "export";
}

/** Base identifier of a possibly chained or curried callee — `describe` in `describe.each([...])('title', …)`. */
function rootCalleeName(callee: Parser.SyntaxNode | null): string | undefined {
  let node = callee;

  while (node) {
    if (node.type === "identifier") {
      return node.text;
    }

    if (node.type === "member_expression") {
      node = node.childForFieldName("object");
      continue;
    }

    if (node.type === "call_expression") {
      node = node.childForFieldName("function");
      continue;
    }

    return undefined;
  }

  return undefined;
}

/** Test-runner macros whose first string argument names the block — the one call family whose title is a meaningful symbol name. */
const TEST_CALL_ROOTS = new Set([
  "describe",
  "it",
  "test",
  "suite",
  "xdescribe",
  "xit",
  "xtest",
  "fdescribe",
  "fit",
  "ftest",
]);

/** Name a test-macro call after its first string argument, or any other call after its plain-identifier/member-chain callee path; undefined otherwise (IIFEs). */
function testCallTitle(call: Parser.SyntaxNode): string | undefined {
  const args = call.childForFieldName("arguments");
  const firstString = args?.namedChildren.find(
    (a) => a.type === "string" || a.type === "template_string",
  );
  const title = firstString?.text
    .slice(1, -1)
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return title !== undefined && title.length > 0 ? title : undefined;
}

function isTestMacroRoot(root: string | undefined): root is string {
  return root !== undefined && TEST_CALL_ROOTS.has(root);
}

/** Plain-identifier or member-chain callee text (e.g. `foo` or `foo.bar`); undefined for anything else, including IIFEs. */
function plainCalleeText(callee: Parser.SyntaxNode | null): string | undefined {
  const isPlainCallee =
    callee?.type === "identifier" || callee?.type === "member_expression";

  return isPlainCallee ? callee.text : undefined;
}

function callSymbolName(call: Parser.SyntaxNode): string | undefined {
  const callee = call.childForFieldName("function");
  const root = rootCalleeName(callee);
  const title = isTestMacroRoot(root) ? testCallTitle(call) : undefined;

  return title ?? plainCalleeText(callee);
}

interface SymbolInfo {
  name?: string;
  type?: string;
}

/** Unwraps an `export_statement` to its declaration or a `decorated_definition` to its wrapped function/class; undefined for any other node. */
function innerDeclarationNode(
  node: Parser.SyntaxNode,
): Parser.SyntaxNode | undefined {
  if (node.type === "export_statement") {
    return node.childForFieldName("declaration") ?? node.namedChildren[0];
  }

  if (node.type === "decorated_definition") {
    return node.namedChildren.find(
      (c) => c.type === "function_definition" || c.type === "class_definition",
    );
  }

  return undefined;
}

function extractSymbolName(node: Parser.SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName("name");

  if (nameNode) {
    return nameNode.text;
  }

  const inner = innerDeclarationNode(node);

  return inner ? extractSymbolName(inner) : undefined;
}

function refineSymbolType(node: Parser.SyntaxNode, initial: string): string {
  const inner = innerDeclarationNode(node);

  return inner ? inferSymbolType(inner.type) : initial;
}

/** Symbol metadata for a top-level node: a statement wrapping a call gets `type: "call"`; other expression statements carry no symbol fields. */
export function symbolInfo(node: Parser.SyntaxNode): SymbolInfo {
  if (node.type !== "expression_statement") {
    const rawType = inferSymbolType(node.type);

    return {
      name: extractSymbolName(node),
      type: refineSymbolType(node, rawType),
    };
  }

  const call = node.namedChildren.find((c) => c.type === "call_expression");

  if (!call) {
    return {};
  }

  return { name: callSymbolName(call), type: "call" };
}
