# Which model decomposes a plan best

**For people choosing the model behind one of Lore's agents.** This records a comparison of eight models on the `feature-decompose` agent, run on 2026-10-06, and the choice it led to.

## Why we measured

`decompose` is the agent on the feature-planning line that turns a merged spec and its approved plan into user stories and tasks. Each task becomes a GitHub issue that a developer, or the implementation loop, works from alone. After it, the `issue-coverage` station counts how many of the spec's testable statements no task names, and sends `decompose` back for those (at most three rounds, FR8.28 in [specs/external-floor](../../specs/external-floor/spec.md)).

The agent ran on `claude-sonnet-4-6`. Nobody had chosen that for decompose: the value was copied from the old agent default when the planning line moved to the external floor (#2319). On the floor an agent's model comes from the pipeline file alone, `libs/assembly-lines/src/floor-pipelines/feature-planning.yaml`; the `/agents` page and the `lore.agent_definitions` row do not reach floor runs.

## Results

Each model ran once on each of three specs in this repository, with the same inputs at the same commit.

| Rank | Model | Model id | Usable runs | Coverage, all 3 specs | issue-triage | in-the-ui-… | github-issue-dispatch | Avg cost per run | Avg time | Plan quotes copied verbatim | Issue detail (chars per task) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Claude Opus 5.5 | `claude-opus-5-5` | 3/3 | **119/125 (95%)** | 60/65 | 26/26 | 33/34 | $1.54 | 257 s | 81/81 | **1120** |
| 2 | Gemini 3.1 Pro (preview) | `gemini-3.1-pro-preview` | 3/3 | 90/125 (72%) | 44/65 | 24/26 | 22/34 | $0.59 | 228 s | 37/37 | 442 |
| 3 | Gemini 3 Flash (preview) | `gemini-3-flash-preview` | 3/3 | 81/125 (65%) | 33/65 | 19/26 | 29/34 | **$0.12** | 129 s | 34/44 | 350 |
| 4 | Claude Sonnet 4.6 | `claude-sonnet-4-6` | 3/3 | 62/125 (50%) | 22/65 | 15/26 | 25/34 | $0.74 | 250 s | 38/44 | 864 |
| 5 | Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | 3/3 | 41/125 (33%) | 13/65 | 10/26 | 18/34 | $0.21 | 128 s | 10/23 | 779 |
| 6 | Gemini 2.5 Flash | `gemini-2.5-flash` | 1/3 | 19/125 (15%) | no file | no file | 19/34 | $0.08 | 174 s | 10/10 | 463 |
| 7 | Gemini 2.5 Pro | `gemini-2.5-pro` | 1/3 | 5/125 (4%) | invalid JSON | 5/26 | invalid JSON | $0.18 | 93 s | 5/5 | 574 |
| 8 | Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | 0/3 | 0/125 | no file | no file | no file | $0.01 | 95 s | — | — |

What the columns mean:

- **Usable runs**: the run wrote a `decomposition.json` that `parseDecomposition` accepts. A run without one fails the `decompose` visit in production.
- **Coverage**: the spec's testable statements some task names in its `spec_lines`, counted with `issueCoverage`, the function the `issue-coverage` station uses. Each statement left out costs another decompose round.
- **Plan quotes copied verbatim**: `plan_quotes` must copy the approved plan as written, because the issue is all a developer reads.
- **Issue detail**: the average length of a task's `changes`, `context` and `test_plan`.
- **Cost**: what the Claude CLI reports for Claude runs. For Gemini runs, token counts at Google's list prices per million input/output tokens: $2/$12 for 3.1 Pro, $0.50/$3 for 3 Flash (assumed), $1.25/$10 for 2.5 Pro, $0.30/$2.50 for 2.5 Flash, $0.10/$0.40 for 2.5 Flash-Lite.

## What we read in it

- **Opus 5.5 is the best decomposer** on every measure that matters: near-full coverage, the most detailed issues, every plan quote exact. It also noticed that a component `tasks.md` named had since been deleted, and wrote the task around that. It costs about 2.6 times as much as Gemini 3.1 Pro, roughly a dollar more per decompose. Fewer coverage rounds pay some of that back.
- **Gemini 3.1 Pro is the value pick.** Second on coverage, every quote exact, issues shorter but still naming the file, the change and what the test asserts. A few of its tasks asked to add helpers that already exist elsewhere; the grounding check catches those and sends them back.
- **Gemini 3 Flash** is very cheap, but its issues are thin: one test plan only said "Run vitest", one run paraphrased every plan quote, and one task named a path that does not exist.
- **Sonnet 4.6**, the setting before this comparison, wrote detailed issues but named the fewest statements of the usable top four.
- **Haiku 4.5** always wrote a valid file, but its coverage was low, and it paraphrased or skipped most plan quotes.
- **The Gemini 2.5 models cannot do this job.** Flash-Lite printed the JSON in its reply instead of writing the file, every time, and still reported success. 2.5 Flash mistyped the spec path once and wrote no file once. 2.5 Pro wrote `\'` escapes, which are invalid JSON, twice.

## What we chose

`decompose` runs on `gemini-3.1-pro-preview` since #2538 (FR8.15.3). Opus 5.5 is the stronger choice if the extra dollar per plan is acceptable; switching is the same one-line change to `feature-decompose.settings.model` in `feature-planning.yaml`, plus its `prices`, and the `model` in `libs/shared/src/agent-defaults/feature-decompose.md` so the two copies agree.

The other four planning agents (`plan-analyze`, `plan-validate`, `spec-analysis`, `spec-write`) still run on `claude-sonnet-4-6` and were not measured.

## How it was run

- **Specs**: `specs/issue-triage/` and `specs/in-the-ui-we-show-that-a-pr-ha/` both have a reviewed `tasks.md`, which decompose is told to transcribe. `specs/github-issue-dispatch/` has a `plan.md` and no `tasks.md`, so decompose derives the tasks itself. All runs read the repository at `adc577abc`.
- **Prompt**: the body of `libs/shared/src/agent-defaults/feature-decompose.md` as shipped, with the `/workspace` paths and placeholders pointed at a local directory per run, holding a detached checkout of the repository, a `spec-plan.json` naming the spec, and the approved plan.
- **Agents**: Claude models through `claude -p --model <id>`; Gemini models through `gemini-cli` 0.62.0 on Vertex AI (`GOOGLE_CLOUD_LOCATION=global`). Both could read files and run shell commands, as a pod can.
- **Scoring**: the planning line's own code. `parseDecomposition` for validity, `specParts` and `issueCoverage` for coverage, `groundingFindings` for names that are not on main.

## Limits

- One run per model per spec. A second run could move a model a place or two; the gaps between the top three were large enough that the order is unlikely to change, but the 2.5 failures might partly be bad luck.
- No Lore MCP tools in any run. Agent pods have them, and decompose rarely needs them.
- The approved plan document lives in lore-api's database, not the repository, so each spec's `plan.md` stood in for it.
- Three specs, all from this repository.
