/**
 * no-forwarding-class — a class whose EVERY method only forwards 1:1 to its
 * single constructor-injected port is indirection without behavior: pass the
 * port itself instead of wrapping it. (TODO-#7 rule: the `Usage` wrapper over
 * `UsagePort`.)
 *
 * Method-level check: a *forwarding method* has a body that is exactly
 * `return this.<dep>.<sameName>(<own params in order>);`. A *forwarding class*
 * has exactly one constructor whose whole parameter list is a single
 * parameter property (`private readonly <dep>: <Port>`), an empty constructor
 * body, at least one other member, and every member a forwarding method.
 * Partial forwarders (any real method, extra ctor params, ctor setup work)
 * are legitimate adapters/facades and are never flagged.
 *
 * Two report sites:
 *  - the class declaration (not fixable — deleting the class file is manual);
 *  - each `new X(port)` usage, resolved CROSS-FILE via the TypeScript checker.
 *    The usage fix replaces `new X(arg)` with `arg`, rewrites `X` type
 *    references in the file to the constructor's port type, and drops the
 *    now-dead import specifier. Type-reference rewrites only run when the port
 *    type name is already in scope — the fix never fabricates an import.
 *
 * Requires type information (parserServices); the rule is inert without it.
 */

import ts from "typescript";

/** `{ depName, portTypeText }` when the ts.ClassDeclaration is a pure forwarder, else null. */
function forwardingShape(classDeclaration) {
  const constructors = classDeclaration.members.filter(
    (member) => ts.isConstructorDeclaration(member) && member.body,
  );
  if (constructors.length !== 1) return null;
  const ctor = constructors[0];
  if (ctor.body.statements.length > 0) return null;
  if (ctor.parameters.length !== 1) return null;
  const param = ctor.parameters[0];
  if (!ts.isParameterPropertyDeclaration(param, ctor)) return null;
  if (!ts.isIdentifier(param.name) || !param.type) return null;
  const depName = param.name.text;

  const others = classDeclaration.members.filter((member) => member !== ctor);
  if (others.length === 0) return null;
  if (!others.every((member) => isForwardingMethod(member, depName))) {
    return null;
  }
  return { depName, portTypeText: param.type.getText() };
}

/** Body is exactly `return this.<depName>.<ownName>(<own params in order>);`. */
function isForwardingMethod(member, depName) {
  if (!ts.isMethodDeclaration(member) || !member.body) return false;
  if (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) {
    return false;
  }
  if (!ts.isIdentifier(member.name)) return false;
  if (
    !member.parameters.every(
      (parameter) =>
        ts.isIdentifier(parameter.name) &&
        !parameter.initializer &&
        !parameter.dotDotDotToken,
    )
  ) {
    return false;
  }
  if (member.body.statements.length !== 1) return false;
  const statement = member.body.statements[0];
  if (!ts.isReturnStatement(statement) || !statement.expression) return false;
  const call = statement.expression;
  if (!ts.isCallExpression(call)) return false;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== member.name.text) return false;
  const receiver = callee.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return false;
  if (receiver.expression.kind !== ts.SyntaxKind.ThisKeyword) return false;
  if (receiver.name.text !== depName) return false;
  return (
    call.arguments.length === member.parameters.length &&
    call.arguments.every(
      (argument, i) =>
        ts.isIdentifier(argument) &&
        argument.text === member.parameters[i].name.text,
    )
  );
}

function classDeclarationOf(symbol, checker) {
  const resolved =
    symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return resolved?.declarations?.find(ts.isClassDeclaration) ?? null;
}

/** All identifiers a file's top level brings into scope (imports + declarations). */
function topLevelNames(program) {
  const names = new Set();
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      statement.specifiers.forEach((specifier) =>
        names.add(specifier.local.name),
      );
    }
    if (statement.id?.type === "Identifier") names.add(statement.id.name);
    const declaration = statement.declaration ?? null;
    if (declaration?.id?.type === "Identifier") names.add(declaration.id.name);
  }
  return names;
}

function collectTypeReferences(node, className, acc = []) {
  if (!node || typeof node.type !== "string") return acc;
  if (
    node.type === "TSTypeReference" &&
    node.typeName.type === "Identifier" &&
    node.typeName.name === className
  ) {
    acc.push(node);
  }
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((child) => collectTypeReferences(child, className, acc));
    } else if (value && typeof value.type === "string") {
      collectTypeReferences(value, className, acc);
    }
  }
  return acc;
}

function removeImportSpecifierFixes(fixer, program, className) {
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const index = statement.specifiers.findIndex(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        specifier.local.name === className,
    );
    if (index === -1) continue;
    if (statement.specifiers.length === 1) return [fixer.remove(statement)];
    const specifier = statement.specifiers[index];
    const neighbor =
      index > 0
        ? statement.specifiers[index - 1]
        : statement.specifiers[index + 1];
    return index > 0
      ? [fixer.removeRange([neighbor.range[1], specifier.range[1]])]
      : [fixer.removeRange([specifier.range[0], neighbor.range[0]])];
  }
  return [];
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "disallow classes that only forward 1:1 to their single injected port — pass the port itself",
    },
    fixable: "code",
    schema: [],
    messages: {
      forwardingClass:
        "Every method of this class only forwards 1:1 to the injected `{{dep}}` — pass the port itself instead of wrapping it.",
      forwardingUsage:
        "`{{name}}` only forwards to its injected port — hand out the {{port}} directly.",
    },
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services?.esTreeNodeToTSNodeMap) return {};

    const checker = services.program.getTypeChecker();
    const sourceCode = context.sourceCode;
    const fixedClasses = new Set();

    return {
      ClassDeclaration(node) {
        const shape = forwardingShape(services.esTreeNodeToTSNodeMap.get(node));
        if (!shape) return;
        context.report({
          node: node.id ?? node,
          messageId: "forwardingClass",
          data: { dep: shape.depName },
        });
      },

      NewExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (
          node.arguments.length !== 1 ||
          node.arguments[0].type === "SpreadElement"
        ) {
          return;
        }
        const symbol = checker.getSymbolAtLocation(
          services.esTreeNodeToTSNodeMap.get(node.callee),
        );
        const declaration = classDeclarationOf(symbol, checker);
        if (!declaration) return;
        const shape = forwardingShape(declaration);
        if (!shape) return;

        const className = node.callee.name;
        context.report({
          node,
          messageId: "forwardingUsage",
          data: { name: className, port: shape.portTypeText },
          fix(fixer) {
            const fixes = [
              fixer.replaceText(node, sourceCode.getText(node.arguments[0])),
            ];
            // File-wide cleanup rides on the first usage fix only, and only
            // when the port type is already in scope — never fabricate imports.
            if (
              !fixedClasses.has(className) &&
              topLevelNames(sourceCode.ast).has(shape.portTypeText)
            ) {
              fixedClasses.add(className);
              collectTypeReferences(sourceCode.ast, className).forEach(
                (reference) =>
                  fixes.push(fixer.replaceText(reference, shape.portTypeText)),
              );
              fixes.push(
                ...removeImportSpecifierFixes(
                  fixer,
                  sourceCode.ast,
                  className,
                ),
              );
            }
            return fixes;
          },
        });
      },
    };
  },
};
