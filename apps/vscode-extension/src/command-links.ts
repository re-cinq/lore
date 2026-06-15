/**
 * Build the `command:` URI that drives every clickable link in a hover or
 * CodeLens. Encoding the args as a single-element array makes VS Code pass the
 * object as the command handler's first positional argument. Pure + tested
 * because a malformed URI silently breaks all navigation.
 */

export interface OpenLocalArgs {
  /** Repo-relative path, resolved against the workspace root by the handler. */
  path: string;
  /** 1-based line to reveal. */
  line: number;
}

export function openLocalCommandUri(target: OpenLocalArgs): string {
  return `command:lore.openLocal?${encodeURIComponent(JSON.stringify([target]))}`;
}
