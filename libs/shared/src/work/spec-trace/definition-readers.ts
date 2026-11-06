// The readers that find a source file's definitions in its tree-sitter tree: functions and function-valued constants, classes with their methods and heritage, interfaces, type aliases and enums, each unwrapped from the export statement that carries it.

import type Parser from "web-tree-sitter";
import type { CodeSymbolKind } from "./reference-extractor.js";

/** One definition as a reader found it, before its lines and calls are read off the node. */
export interface Definition {
  name: string;
  kind: CodeSymbolKind;
  exported: boolean;
  container?: string;
  extends: string[];
  implements: string[];
  node: Parser.SyntaxNode;
}

const FUNCTION_VALUES = new Set([
  "arrow_function",
  "function_expression",
  "function",
]);

type DefinitionReader = (node: Parser.SyntaxNode) => Definition[];

function definition(
  name: string,
  kind: CodeSymbolKind,
  node: Parser.SyntaxNode,
): Definition {
  return { name, kind, exported: false, extends: [], implements: [], node };
}

const METHOD_NODES = new Set([
  "method_definition",
  "abstract_method_signature",
]);

/** One definition per method name: the constructor is the class, and a getter and setter pair is one method. */
function methodsOf(
  className: string,
  body: Parser.SyntaxNode | null,
): Definition[] {
  const seen = new Set<string>(["constructor"]);

  return (body?.namedChildren ?? []).flatMap((member) => {
    const name = member.childForFieldName("name")?.text;

    if (!METHOD_NODES.has(member.type) || !name || seen.has(name)) {
      return [];
    }
    seen.add(name);

    return [
      {
        ...definition(`${className}.${name}`, "method", member),
        container: className,
      },
    ];
  });
}

/** `class C extends B implements I` defines `C` with its heritage, then one `C.m` per method of its body; `export default class {}` has no name and defines nothing. */
const classDeclaration: DefinitionReader = (node) => {
  const name = node.childForFieldName("name")?.text;

  if (!name) {
    return [];
  }
  const heritage = childOfType(node, "class_heritage");
  const body = childOfType(node, "class_body");

  return [
    {
      ...definition(name, "class", node),
      extends: namesIn(childOfType(heritage, "extends_clause")).slice(0, 1),
      implements: namesIn(childOfType(heritage, "implements_clause")),
    },
    ...methodsOf(name, body),
  ];
};

const interfaceDeclaration: DefinitionReader = (node) => {
  const name = node.childForFieldName("name")?.text;

  return name
    ? [
        {
          ...definition(name, "interface", node),
          extends: namesIn(childOfType(node, "extends_type_clause")),
        },
      ]
    : [];
};

/** `export` is unwrapped to the declaration it carries, marking it exported and keeping the export's span; a method keeps its own node. */
const exported: DefinitionReader = (node) => {
  const declaration = node.childForFieldName("declaration");
  const inner = declaration ? definitionsOf(declaration) : [];

  return inner.map((found) => ({
    ...found,
    exported: true,
    node: found.container ? found.node : node,
  }));
};

/** `const f = () => ...` defines `f`; a constant holding anything but a function defines nothing. */
const functionConstants: DefinitionReader = (node) => {
  const declarators = node.namedChildren.filter((declarator) =>
    FUNCTION_VALUES.has(declarator.childForFieldName("value")?.type ?? ""),
  );

  return declarators.flatMap((declarator) => {
    const name = declarator.childForFieldName("name")?.text;

    return name ? [definition(name, "function", node)] : [];
  });
};

/** A named declaration (`function f`, `type T`, `enum E`) defines its own name. */
const namedDeclaration =
  (kind: CodeSymbolKind): DefinitionReader =>
  (node) => {
    const name = node.childForFieldName("name")?.text;

    return name ? [definition(name, kind, node)] : [];
  };

const DEFINITION_READERS: Partial<Record<string, DefinitionReader>> = {
  export_statement: exported,
  function_declaration: namedDeclaration("function"),
  class_declaration: classDeclaration,
  abstract_class_declaration: classDeclaration,
  interface_declaration: interfaceDeclaration,
  type_alias_declaration: namedDeclaration("type"),
  enum_declaration: namedDeclaration("enum"),
  lexical_declaration: functionConstants,
  variable_declaration: functionConstants,
};

/** The named definitions one top-level statement introduces. */
export function definitionsOf(node: Parser.SyntaxNode): Definition[] {
  return DEFINITION_READERS[node.type]?.(node) ?? [];
}

function childOfType(
  node: Parser.SyntaxNode | null,
  type: string,
): Parser.SyntaxNode | null {
  return node?.namedChildren.find((child) => child.type === type) ?? null;
}

/** The bare names a heritage clause lists, in order. */
function namesIn(clause: Parser.SyntaxNode | null): string[] {
  return (clause?.namedChildren ?? []).map((child) => child.text);
}
