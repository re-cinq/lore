import type Parser from "web-tree-sitter";

export function isLocatedCallback(
  node: Parser.SyntaxNode,
  location: { line: number; column: number },
): boolean {
  const reportedAtCall = registrationAnchors(node).some(
    (anchor) =>
      anchor.row + 1 === location.line && anchor.column + 1 === location.column,
  );

  return node.type === "call_expression" && reportedAtCall && hasCallback(node);
}

/** Where vitest may say a registration begins: the call, a modifier member (`it.only`), or the end of a curried callee (`it.each([1, 2])`). */
function registrationAnchors(call: Parser.SyntaxNode): Parser.Point[] {
  const callee = call.childForFieldName("function");

  if (callee?.type === "member_expression") {
    return [call.startPosition, ...memberStart(callee)];
  }

  if (callee?.type === "call_expression") {
    return [
      call.startPosition,
      callee.endPosition,
      ...registrationAnchors(callee),
    ];
  }

  return [call.startPosition];
}

function memberStart(member: Parser.SyntaxNode): Parser.Point[] {
  const property = member.childForFieldName("property");

  return property ? [property.startPosition] : [];
}

function hasCallback(node: Parser.SyntaxNode): boolean {
  const args = node.childForFieldName("arguments");

  return (
    args?.namedChildren.some((child) =>
      ["arrow_function", "function_expression"].includes(child.type),
    ) ?? false
  );
}
