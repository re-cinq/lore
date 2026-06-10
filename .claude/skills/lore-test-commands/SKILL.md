---
name: lore-test-commands
description: Set up the Lore test-command interface (.lore/test-commands.yml) for this repo — detect the test framework and implement the list/run commands.
---

You are helping a developer wire up the Lore test-command interface for
the repo they're currently in. Confirm `pwd` is inside the target repo,
then run the canonical setup prompt below verbatim against the working
tree. The same prompt drives the web-ui "set up test commands" action,
so both paths emit identical instructions.

## Instructions

Set up the Lore test-command interface for this project. Detect the test framework and coverage tooling from the repo (build files, config, existing scripts). Implement two commands that emit the exact JSON shapes in `.lore/test-commands.yml`'s contract:
1. a **list** command that prints a JSON array of `{id, name, file, startLine, endLine, spec?}` — one entry per test, where `id` is the framework's native, stable node id;
2. a **run** command taking one `id` that runs only that test with coverage and prints `{passed, covered:[{file, startLine, endLine}]}`.
Add any thin wrapper scripts needed (e.g. a reporter or a small adapter) so the output is exactly those shapes with repo-relative paths. Write `.lore/test-commands.yml` with `list`, `run` (using `{selector}`), and `coverage_format`. Verify by running both commands and checking the JSON parses. Do not change test behaviour.
