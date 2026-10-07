// A generated text's findings (groundingFindings), its identifiers checked against the files on the tree it names: what both coverage checks of the feature-planning line send their writer back with.

import {
  declaredNewPaths,
  groundingFindings,
  namedPaths,
  type GroundedFile,
} from "@re-cinq/lore-shared/feature-planning/grounding.js";

export interface TextToGround {
  /** What the findings are listed under: a spec path or a task id. */
  path: string;
  text: string;
}

/** What a set of texts says the feature adds, so one text may name what another creates. */
export function addedAcross(texts: readonly TextToGround[]): string[] {
  return texts.flatMap(({ text }) => declaredNewPaths(text));
}

export async function groundedText(
  { path, text }: TextToGround,
  tree: readonly string[],
  read: (path: string) => Promise<string | null>,
  added: readonly string[] = [],
): Promise<GroundedFile> {
  const named = namedPaths(text).filter((name) => tree.includes(name));
  const contents = await Promise.all(named.map(read));
  const files = Object.fromEntries(
    named.flatMap((name, index) => {
      const content = contents[index];

      return content === null ? [] : [[name, content]];
    }),
  );

  return { path, findings: groundingFindings({ text, tree, files, added }) };
}

export function findingsIn(grounded: readonly GroundedFile[]): number {
  return grounded.reduce((sum, file) => sum + file.findings.length, 0);
}
