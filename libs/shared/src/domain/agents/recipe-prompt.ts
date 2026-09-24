/** What every agent run is told about its own context: fills the recipe's `{context}` slot with an instruction (not the fetched context itself — that needed a central-only credential, so every run now opens cold and identically regardless of cluster). */
export const CONTEXT_BOOTSTRAP =
  "First step: nothing is pre-loaded for this run — call the Lore MCP server's " +
  "`lore_assemble_context` tool, then `lore_search_memory` for past learnings, before " +
  "you change anything. Pass `repo` (the owner/name above) on every call: the shared " +
  "server has no checkout to detect it from. Query with what the work is ABOUT — the " +
  "title, the feature, the spec sections and the surfaces it touches — not the words " +
  "of this instruction, or you get the platform overview back. Your CLI may list the " +
  "tools under the server's prefix. The `lore_*` tools stay live for the whole run.";

const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/g;

/** What the pod's model actually receives: the subsystem's `renderPrompt` rule (plain `{name}` substitution from the Agent CR's parameters, an unmatched placeholder left literal). Kept here so a Floor-side test can assert on the POD's view of a dispatch, not only on the string the Floor sent — #2051 hid for weeks because every test read the parameter nothing rendered. */
export function renderPodPrompt(
  template: string,
  parameters: Readonly<Record<string, string>>,
): string {
  return template.replace(PLACEHOLDER, (token, name: string) =>
    name in parameters ? parameters[name] : token,
  );
}
