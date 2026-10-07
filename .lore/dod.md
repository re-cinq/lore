# Definition of Done

> The binary does something else: `apps/lore-code-trace/report.go:108` groups descriptors by file and calls `runOneFile`, which substitutes the **file path** (`substituteSelector(m.Run, file)`) and tags every descriptor in that file with the same pass/fail + coverage.

**Strategy: `mechanical`** — the binary already substitutes repo-relative file paths into `{selector}` (implemented, tested by the Go report tests); `lore_run_test` already substitutes the descriptor id (tested by the TS manifest tests). The only thing wrong is the documentation: the contract, the setup prompt, the skill text, and spec statement 14 all say `{selector}` is always a `tests.list` id. The fix is a prose correction across those files so the contract matches the binary's actual caller path.

## Done when these pass

- [ ] **`substituteSelector` — replaces every `{selector}` placeholder with the runner-native id** — MCP caller path; the function is generic and the test name describes that caller. Stays green while the contract prose is corrected to name the binary's file-path caller too.
  `libs/shared/src/domain/test-command-manifest.test.ts`

- [ ] **`TEST_COMMAND_SETUP_PROMPT` — is a non-empty string / names no concrete language or test runner** — both tests stay green regardless of how the prompt's `{selector}` description is reworded.
  `libs/shared/src/lib/test-command-setup-prompt.test.ts`

- [ ] **`lore-test-commands skill — carries the canonical TEST_COMMAND_SETUP_PROMPT verbatim`** — the skill file must stay byte-identical to the shared constant; this guards against the two diverging.
  `libs/shared/src/lib/lore-test-commands-skill.test.ts`

## Facets

- [x] Read contracts/test-commands.md line 80 and the three example manifests
- [x] Rewrite the `{selector}` paragraph (line 80 area) to name both callers: CI binary substitutes the repo-relative test file; `lore_run_test` substitutes the descriptor id; `run` must accept both
- [x] Update the Go example — `go test -run '{selector}'` treats the selector as a test-name regex, which breaks when the binary passes a file path; replace with an approach that works with a file path (e.g. derive the package from the file)
- [x] Update `TEST_COMMAND_SETUP_PROMPT` — change "a **run** command taking one `id`" to clarify that `{selector}` is a repo-relative file path from CI and a descriptor id from `lore_run_test`
- [x] Update `.claude/skills/lore-test-commands/SKILL.md` to mirror the prompt constant (the skill-prompt test guards this)
- [x] Update spec statement 14 to mention both callers (binary: file path; MCP: runner-native id)
- [x] Run `npx prettier --write` on changed `.ts`/`.md` files; commit; push

## Out of scope

- Changing any binary or MCP tool code — both already implement the correct behavior
- Adding per-test (rather than per-file) coverage for Go — that is a separate limitation tracked in the spec's Open Questions
- Updating the onboarding agent's per-toolchain templates (LORE_TESTS_INSTRUCTION) — that instruction covers the CI workflow, not the run command shape; it does not repeat the id wording
