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

/** Every uid the named node types hold for this repo, in one query — one round trip keeps the cleanup fast enough to run after each test. */
async function findRepoNodeUids(
  txn: ReturnType<dgraph.DgraphClient["newTxn"]>,
  nodeTypes: RepoNodeType[],
  vars: Record<string, string>,
): Promise<string[]> {
  const query = `query nodes(${declareVars(vars)}) {\n${nodeTypes
    .map((nodeType) => `  ${queryLine(nodeType)}`)
    .join("\n")}\n}`;
  const res = await txn.queryWithVars(
    query,
    Object.fromEntries(
      Object.entries(vars).map(([name, value]) => [`$${name}`, value]),
    ),
  );
  const written = res.data as Record<string, { uid: string }[] | undefined>;

  return nodeTypes
    .flatMap((nodeType) => written[nodeType.alias] ?? [])
    .map((node) => node.uid);
}

/** Deletes every uid the repo holds across the named node types, in one mutation. */
async function sweepRepoNodes(
  txn: ReturnType<dgraph.DgraphClient["newTxn"]>,
  nodeTypes: RepoNodeType[],
  vars: Record<string, string>,
): Promise<void> {
  const uids = await findRepoNodeUids(txn, nodeTypes, vars);

  if (!uids.length) {
    return;
  }

  await txn.mutate({
    deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
    commitNow: true,
  });
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
    const txn = dgraphClient.newTxn();

    try {
      await sweepRepoNodes(txn, nodeTypes, { repo, ...extraVars });
    } catch {
      // Cleanup must never mask the test's actual assertion failure.
    } finally {
      await txn.discard().catch(() => {});
    }
  };
}
