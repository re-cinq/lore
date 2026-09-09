/** Per-it line resolver (ADR-023); scans test source for it/test declarations and stamps [startLine, endLine] on matching descriptors. */

import type { TestDescriptor } from "../../domain/test-report.js";

/** `it("…")` / `test('…')` / `it.skip(`…`)` at the start of a line; group 2 is the test string. */
const DECLARATION =
  /^\s*(?:it|test)(?:\.(?:only|skip|todo|concurrent|sequential|fails))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

interface Declaration {
  name: string;
  line: number;
}

export function resolveTestLines(
  content: string,
  descriptors: TestDescriptor[],
): TestDescriptor[] {
  const declarations = findDeclarations(content);
  const lastLine = content.split("\n").length;

  return descriptors.map((descriptor) =>
    stampLines(descriptor, declarations, lastLine),
  );
}

function findDeclarations(content: string): Declaration[] {
  const declarations: Declaration[] = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const match = DECLARATION.exec(lines[index]);

    if (match) {
      declarations.push({ name: match[2], line: index + 1 });
    }
  }

  return declarations;
}

/** One descriptor stamped with the [startLine, endLine] of its matching declaration; unmatched descriptors pass through untouched. */
function stampLines(
  descriptor: TestDescriptor,
  declarations: Declaration[],
  lastLine: number,
): TestDescriptor {
  const leaf = leafName(descriptor.name);
  const index = declarations.findIndex(
    (declaration) => declaration.name === leaf,
  );

  if (index === -1) {
    return descriptor;
  }
  const hasNext = index + 1 < declarations.length;

  return {
    ...descriptor,
    startLine: declarations[index].line,
    endLine: hasNext ? declarations[index + 1].line - 1 : lastLine,
  };
}

function leafName(descriptorName: string): string {
  const segments = descriptorName.split(" > ");

  return segments[segments.length - 1];
}
