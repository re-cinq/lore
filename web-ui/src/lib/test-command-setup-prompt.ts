/**
 * In-sync mirror of `shared/src/test-command-setup-prompt.ts`. web-ui is
 * not a workspace member, so it can't import from `@re-cinq/lore-shared`
 * directly. Keep both copies in step — the byte content here is fed to
 * Claude Code by the "set up test commands" action and must match what the
 * `/lore-test-commands` skill installs. See web-ui/CLAUDE.md and
 * `lib/ingest-workflow.ts` for the mirror pattern.
 */

export const TEST_COMMAND_SETUP_PROMPT = `Set up the Lore test-command interface for this project. Detect the test framework and coverage tooling from the repo (build files, config, existing scripts). Implement two commands that emit the exact JSON shapes in \`.lore/test-commands.yml\`'s contract:
1. a **list** command that prints a JSON array of \`{id, name, file, startLine, endLine, spec?}\` — one entry per test, where \`id\` is the framework's native, stable node id;
2. a **run** command taking one \`id\` that runs only that test with coverage and prints \`{passed, covered:[{file, startLine, endLine}]}\`.
Add any thin wrapper scripts needed (e.g. a reporter or a small adapter) so the output is exactly those shapes with repo-relative paths. Write \`.lore/test-commands.yml\` with \`list\`, \`run\` (using \`{selector}\`), and \`coverage_format\`. Verify by running both commands and checking the JSON parses. Do not change test behaviour.`;
