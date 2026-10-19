/** The it/test declarations of a test file's source, read by line: how the line resolver finds a test's span (ADR-023) and how a spec link whose label is not a title finds the title of the test at its anchor. */

/** `it("…")` / `test('…')` / `it.skip(`…`)` at the start of a line; group 2 is the test string. */
const DECLARATION =
  /^\s*(?:it|test)(?:\.(?:only|skip|todo|concurrent|sequential|fails))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

export interface TestDeclaration {
  name: string;
  line: number;
}

export function testDeclarations(content: string): TestDeclaration[] {
  return content.split("\n").flatMap((text, index) => {
    const match = DECLARATION.exec(text);

    return match ? [{ name: match[2], line: index + 1 }] : [];
  });
}

/** The title of the test whose span holds the line: the last declaration at or above it, or null above the first. */
export function testTitleAt(content: string, line: number): string | null {
  const enclosing = testDeclarations(content)
    .filter((declaration) => declaration.line <= line)
    .at(-1);

  return enclosing?.name ?? null;
}
