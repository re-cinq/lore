// Shared by every station-pod route: the {owner}/{repo} param joiner and the uniform 500 shape.

export const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;

export const fail = (h: import("@hapi/hapi").ResponseToolkit, err: unknown) =>
  h
    .response({ error: err instanceof Error ? err.message : String(err) })
    .code(500);
