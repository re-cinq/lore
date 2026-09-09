// Encodes args as a single-element array so VS Code passes the object as the command handler's first positional arg.

export interface OpenLocalArgs {
  /** Repo-relative path, resolved against the workspace root by the handler. */
  path: string;
  /** 1-based line to reveal. */
  line: number;
}

export function openLocalCommandUri(target: OpenLocalArgs): string {
  return `command:lore.openLocal?${encodeURIComponent(JSON.stringify([target]))}`;
}
