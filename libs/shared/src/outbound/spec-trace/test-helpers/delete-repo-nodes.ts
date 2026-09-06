import type * as dgraph from "dgraph-js-http";

export interface RepoNodeType {
  alias: string;
  type: string;
  field?: string;
  varName?: string;
}

function queryLine({
  alias,
  type,
  field = "repo",
  varName = "repo",
}: RepoNodeType): string {
  return `${alias}(func: eq(${type}.${field}, $${varName})) { uid }`;
}

function declareVars(vars: Record<string, string>): string {
  return Object.keys(vars)
    .map((name) => `$${name}: string`)
    .join(", ");
}

/** Builds the per-suite `deleteRepoNodes` cleanup closure, parameterised by which node types to sweep. */
export function makeDeleteRepoNodes(
  dgraphClient: dgraph.DgraphClient,
  nodeTypes: RepoNodeType[],
) {
  return async function deleteRepoNodes(
    repo: string,
    extraVars: Record<string, string> = {},
  ): Promise<void> {
    const vars = { repo, ...extraVars };
    const txn = dgraphClient.newTxn();

    try {
      const query = `query nodes(${declareVars(vars)}) {\n${nodeTypes
        .map((nodeType) => `  ${queryLine(nodeType)}`)
        .join("\n")}\n}`;
      const queryVars = Object.fromEntries(
        Object.entries(vars).map(([name, value]) => [`$${name}`, value]),
      );
      const res = await txn.queryWithVars(query, queryVars);
      const written = res.data as Record<string, { uid: string }[] | undefined>;
      const uids = nodeTypes
        .flatMap((nodeType) => written[nodeType.alias] ?? [])
        .map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      // Cleanup must never mask the test's actual assertion failure.
    } finally {
      await txn.discard().catch(() => {});
    }
  };
}
