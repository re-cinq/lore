# Lore Assembly Lines (`@re-cinq/lore-assembly-lines`)

The **floor pipeline files** Lore's lines run from, and the few parsers Lore's
floor stations share. Every line runs on the external floor
([re-cinq/floor](https://github.com/re-cinq/floor),
[ADR-049](../../adrs/ADR-049-external-floor.md)); the definition loader and the
transition replay of the engine Lore ran itself were deleted on 2026-10-02.
See [ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md) for the
Factory ⊃ Floor ⊃ **AssemblyLine** ⊃ Station ⊃ Agent vocabulary. Depends only on
`@re-cinq/lore-shared` — no DB, Octokit, or K8s client.

## Pipeline files

One YAML file per line in [`src/floor-pipelines/`](./src/floor-pipelines/),
copied into `dist/` at build time. A file has three blocks: `line` (the graph:
`entry`, `exit`, `args`, `nodes`, `edges`), `stations` (what each station needs,
produces and can report) and `agent_definitions` (model, image, timeout and the
prompt, inline). lore-api puts every file to the floor at boot; a file's content
is its version, so only a changed file becomes a new version.

| File | What the line does |
| --- | --- |
| `code-review.yaml` | Reviews a pull request and posts the review |
| `code-review-recheck.yaml` | Re-checks a pull request after a push, from the last verdict |
| `code-review-reply.yaml` | Answers a review that requested changes |
| `implementation-loop.yaml` | Works one backlog ticket to a pull request ready for review |
| `feature-planning.yaml` | Drafts a plan with its people, writes the specs, opens the spec PR, files the tasks |
| `onboard.yaml` | Enrols a repository and opens its one onboarding pull request |
| `spec-upkeep.yaml` | Fixes drifted specs and adds missing test links, weekly |
| `daily-digest.yaml` | Writes and posts the daily Slack digest |
| `merge.yaml` | The bookkeeping once a task's pull request has merged |
| `lore-run-settled.yaml` | Tells Lore when a run of any line settles |

`src/floor-pipelines/floor-pipelines.test.ts` pins the set of files and the
shape of each line. What a new line needs is in
[`.lore/assembly-line-guide.md`](../../.lore/assembly-line-guide.md).

## Parsers

- `parseReviewVerdict` (`src/node-outcome.ts`): the one `REVIEW_RESULT:` line a
  review agent prints, as `success`, `changes_requested` or null.
- `resultTextFromOutput` (`src/agent-output.ts`): the agent's text from its
  terminal result line, reassembled from delta chunks for the Gemini shape.
- `eventLine` (`src/agent-output.ts`): the log line a station prints.
- `NodeResult` (`src/node-types.ts`): what a station of Lore's reports.

## Develop

```bash
npm install                                    # from the repo root (workspace member)
npm run build -w @re-cinq/lore-assembly-lines  # tsc + copy the YAMLs into dist/
npm test  -w @re-cinq/lore-assembly-lines
```
