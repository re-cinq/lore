/**
 * spec-traceability-graph — sentence-link resolver. Turns a parsed
 * {@link SentenceLink} (from a `<spec> | <sentence> | <label>` test name) into
 * the uids of the Statement/AcceptanceCriterion nodes it links: the `<spec>`
 * segment substring-matches a Spec.title, and `<sentence>` substring-matches a
 * Statement/AcceptanceCriterion under that spec, both under
 * {@link normalizeForMatch} (shallow: lowercase, whitespace-free, link-parens
 * stripped). Scoped to the matched spec(s); returns every node that matches (the
 * caller links them all and logs a 0/over-match). Talks only to the injected
 * DgraphClientPort.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import { matchesNormalized, type SentenceLink } from "./sentence-link.js";

interface SpecRow {
  "Spec.title"?: string;
  stmts?: Array<{ uid: string; "Statement.text"?: string }>;
  acs?: Array<{ uid: string; "AcceptanceCriterion.text"?: string }>;
}

/** A node a sentence-link resolved to — its uid and which `*.validated_by` predicate it carries. */
export interface SentenceMatch {
  uid: string;
  nodeType: "Statement" | "AcceptanceCriterion";
}

export async function resolveSentenceLink(
  dgraph: DgraphClientPort,
  repo: string,
  link: SentenceLink,
): Promise<SentenceMatch[]> {
  const specs = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($repo: string) {
        specs(func: eq(Spec.repo, $repo)) {
          Spec.title
          stmts: ~Statement.spec { uid Statement.text }
          acs: ~AcceptanceCriterion.spec { uid AcceptanceCriterion.text }
        }
      }`,
      { $repo: repo },
    );

    return (res.data?.specs ?? []) as SpecRow[];
  });

  const matched: SentenceMatch[] = [];

  for (const spec of specs) {
    if (!matchesNormalized(spec["Spec.title"] ?? "", link.spec)) {
      continue;
    }

    matched.push(
      ...(spec.stmts ?? [])
        .filter((stmt) =>
          matchesNormalized(stmt["Statement.text"] ?? "", link.sentence),
        )
        .map((stmt): SentenceMatch => ({
          uid: stmt.uid,
          nodeType: "Statement",
        })),
    );
    matched.push(
      ...(spec.acs ?? [])
        .filter((ac) =>
          matchesNormalized(
            ac["AcceptanceCriterion.text"] ?? "",
            link.sentence,
          ),
        )
        .map((ac): SentenceMatch => ({
          uid: ac.uid,
          nodeType: "AcceptanceCriterion",
        })),
    );
  }

  return matched;
}
