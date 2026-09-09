/** Sentence-link resolver; substring-matches spec.title and statement/AC text; scoped to matched spec(s). */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
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
  const specs = await readRepoSpecs(dgraph, repo);
  const matched: SentenceMatch[] = [];

  for (const spec of specs) {
    if (!matchesNormalized(spec["Spec.title"] ?? "", link.spec)) {
      continue;
    }

    matched.push(...matchesIn(spec, link.sentence));
  }

  return matched;
}

/** Every spec in the repo with its statements and acceptance criteria. One query rather than per-spec reads: a link names a spec by TITLE, so the match cannot be pushed into the query. */
async function readRepoSpecs(
  dgraph: DgraphClientPort,
  repo: string,
): Promise<SpecRow[]> {
  return withTxn(dgraph, async (txn) => {
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

    return (res.data.specs ?? []) as SpecRow[];
  });
}

/** Statements and acceptance criteria whose text matches. Both are searched because a link may name either — an AC is a statement a reader can check, and the two are separate nodes only because the graph distinguishes them. */
function matchesIn(spec: SpecRow, sentence: string): SentenceMatch[] {
  return [
    ...(spec.stmts ?? [])
      .filter((stmt) =>
        matchesNormalized(stmt["Statement.text"] ?? "", sentence),
      )
      .map((stmt): SentenceMatch => ({ uid: stmt.uid, nodeType: "Statement" })),
    ...(spec.acs ?? [])
      .filter((ac) =>
        matchesNormalized(ac["AcceptanceCriterion.text"] ?? "", sentence),
      )
      .map((ac): SentenceMatch => ({
        uid: ac.uid,
        nodeType: "AcceptanceCriterion",
      })),
  ];
}
