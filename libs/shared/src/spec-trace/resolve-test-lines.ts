/**
 * spec-traceability-graph — per-`it` line resolver (ADR-023).
 *
 * `vitest list --json` emits only `{name, file}`, so descriptors are line-blind
 * and the line-precise inline spec links have nothing to bind against. This pure
 * resolver scans a test file's source for each `it`/`test` declaration and its
 * line, then stamps the `[startLine, endLine]` span onto the descriptor whose
 * LEAF name (the segment after the last ` > ` of the describe chain) matches the
 * declared test string. A declaration's span runs to the next declaration's line
 * minus one, or to end of file for the last. Descriptors whose leaf name matches
 * no declaration are returned unchanged — the binder then skips them.
 *
 * Line-blind in → line-bearing out, so {@link bindDescriptorsToSpecLinks} can
 * match `([validated by](test.ts#Lline))` against the test it names.
 */

import type { TestDescriptor } from "../test-report.js";

/** `it("…")` / `test('…')` / `it.skip(`…`)` at the start of a line; group 2 is the test string. */
const DECLARATION =
  /^\s*(?:it|test)(?:\.(?:only|skip|todo|concurrent|sequential|fails))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

interface Declaration {
  name: string;
  line: number;
}

function findDeclarations(content: string): Declaration[] {
  const declarations: Declaration[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = DECLARATION.exec(lines[index]);
    if (match) declarations.push({ name: match[2], line: index + 1 });
  }
  return declarations;
}

function leafName(descriptorName: string): string {
  const segments = descriptorName.split(" > ");
  return segments[segments.length - 1];
}

export function resolveTestLines(content: string, descriptors: TestDescriptor[]): TestDescriptor[] {
  const declarations = findDeclarations(content);
  const lastLine = content.split("\n").length;

  return descriptors.map((descriptor) => {
    const leaf = leafName(descriptor.name);
    const index = declarations.findIndex((declaration) => declaration.name === leaf);
    if (index === -1) return descriptor;
    const startLine = declarations[index].line;
    const endLine = index + 1 < declarations.length ? declarations[index + 1].line - 1 : lastLine;
    return { ...descriptor, startLine, endLine };
  });
}
