// The spec a decomposition names statements of, read at the commit decompose read it, so the lines its tasks name are the lines decompose saw.

import {
  specFileOf,
  specParts,
  statementLink,
  type SpecPart,
} from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";

export interface DecomposedSpec {
  parts: SpecPart[];
  linkOf(line: number): string;
}

export interface SpecWhere {
  repo: string;
  /** Read at when the decomposition names no commit. */
  branch: string;
  specPath?: string;
  commit?: string;
  /** Narrows the count to the statements this plan wrote. */
  planId?: string;
}

export type ReadSpec = (path: string, ref: string) => Promise<string | null>;

/** Undefined when the plan names no spec, or the branch holds no such file: then there is nothing to cite. */
export async function decomposedSpec(
  read: ReadSpec,
  { repo, branch, specPath, commit, planId }: SpecWhere,
): Promise<DecomposedSpec | undefined> {
  if (!specPath) {
    return undefined;
  }
  const file = specFileOf(specPath);
  const ref = commit ?? branch;
  const text = await read(file, ref);

  return text === null
    ? undefined
    : {
        parts: specParts(text, planId),
        linkOf: (line) => statementLink({ repo, file, ref, line }),
      };
}
