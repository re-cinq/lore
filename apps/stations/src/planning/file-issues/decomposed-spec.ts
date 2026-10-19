// The specs a decomposition names statements of, read at the commit decompose read them, so the lines its tasks name are the lines decompose saw.

import {
  specParts,
  statementLink,
  type SpecFile,
} from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import type { SpecLine } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";

export interface DecomposedSpecs {
  /** The spec the plan is chiefly about first, then every other one its spec PR wrote. */
  specs: SpecFile[];
  linkOf(cited: SpecLine): string;
}

export interface SpecWhere {
  repo: string;
  /** Read at when the decomposition names no commit. */
  branch: string;
  /** The spec.md files, the main one first. */
  specFiles: readonly string[];
  commit?: string;
  /** Narrows the count to the statements this plan wrote. */
  planId?: string;
}

export type ReadSpec = (path: string, ref: string) => Promise<string | null>;

/** Undefined when the plan names no spec, or the branch holds no main spec: then there is nothing to cite. Another spec missing from the branch is left out. */
export async function decomposedSpecs(
  read: ReadSpec,
  { repo, branch, specFiles, commit, planId }: SpecWhere,
): Promise<DecomposedSpecs | undefined> {
  const ref = commit ?? branch;
  const texts = await Promise.all(specFiles.map((file) => read(file, ref)));
  const specs = specFiles.flatMap((file, index) => {
    const text = texts[index];

    return text === null ? [] : [{ file, parts: specParts(text, planId) }];
  });
  const main = specs.at(0);

  return main && main.file === specFiles[0]
    ? {
        specs,
        linkOf: ({ file = main.file, line }) =>
          statementLink({ repo, file, ref, line }),
      }
    : undefined;
}
