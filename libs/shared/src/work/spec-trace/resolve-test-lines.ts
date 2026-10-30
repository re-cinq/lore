import type { TestDescriptor } from "../../domain/test-report.js";
import {
  testDeclarations,
  type TestDeclaration,
} from "../../domain/spec-trace/test-declarations.js";

export function resolveTestLines(
  content: string,
  descriptors: TestDescriptor[],
): TestDescriptor[] {
  const declarations = testDeclarations(content);
  const lastLine = content.split("\n").length;

  if (descriptors.some(hasRunnerId)) {
    return nativeLines(descriptors, declarations, lastLine);
  }

  return descriptors.map((descriptor) =>
    stampLines(descriptor, declarations, lastLine),
  );
}

function hasRunnerId(descriptor: TestDescriptor): boolean {
  return "runnerId" in descriptor && typeof descriptor.runnerId === "string";
}

/** A native test ends before the next declaration in the file, reported or not: a skipped test the runner left out is still where the previous one stops. */
function nativeLines(
  descriptors: TestDescriptor[],
  declarations: TestDeclaration[],
  lastLine: number,
): TestDescriptor[] {
  if (descriptors.some((descriptor) => !descriptor.startLine)) {
    return descriptors;
  }

  const starts = new Set([
    ...descriptors.map((descriptor) => descriptor.startLine!),
    ...declarations.map((declaration) => declaration.line),
  ]);
  const lines = [...starts].sort((first, second) => first - second);
  const ends = new Map(
    lines.map((line, index) => [line, (lines[index + 1] ?? lastLine + 1) - 1]),
  );

  return descriptors.map((descriptor) => ({
    ...descriptor,
    endLine: ends.get(descriptor.startLine!),
  }));
}

/** One descriptor stamped with the [startLine, endLine] of its matching declaration; unmatched descriptors pass through untouched. */
function stampLines(
  descriptor: TestDescriptor,
  declarations: TestDeclaration[],
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
