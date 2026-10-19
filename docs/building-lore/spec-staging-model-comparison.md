# Which model checks a spec best

**For people choosing the model behind one of Lore's agents.** This records a comparison of three Gemini models on the three checking agents of the staged plan-to-spec line (`spec-notes-check`, `spec-qa-generate`, `spec-qa-answer`), run on 2026-10-08, and what it says about the choice.

> **Since this was run:** `spec-notes-check` no longer exists. Plan comments, answers and open questions became `note` questions in the frozen set that `spec-qa-generate` writes once, so the notes-check results below describe a stage the line has dropped. The `qa-generate` and `qa-answer` findings still apply.

## Why we measured

After a plan is approved, the feature-planning line writes the spec in stages and then tests it before the pull request opens (FR-24 in [specs/7-feature-planning](../../specs/7-feature-planning/spec.md)). Three agents do the testing:

- `spec-notes-check` marks every plan comment, answer and open question as reflected in the spec or not.
- `spec-qa-generate` reads the plan alone and writes true-or-false questions about it.
- `spec-qa-answer` reads the spec alone and answers those questions.

`qa-gate` sends the writer back with whatever failed, up to five times. A check that misses a lost requirement lets it through; a check that flags something the spec does say wastes a writer round and a pod.

All four new agents were switched to `gemini-3.1-pro-preview` at once, without measuring. Before paying Pro prices for every check, we wanted to know whether a cheaper model does the same job. The writer agents, `spec-draft` and `spec-write`, were not measured.

## Results

Each model ran every task on three specs in this repository, with the same inputs. Each spec was tested once intact and five times with one plan item's spec line deleted, so every deletion has a known answer. That is 15 deleted items and 237 present ones per run, in 18 calls. `notes-check` and `qa-answer` ran twice per model; `qa-generate` ran once.

**`notes-check`** (found = deleted plan points the model marked as not reflected, of 15)

| Rank | Model | Model id | Found | Marked missing but present (of 237) | Avg cost per run | Avg time | Output tokens |
|---|---|---|---|---|---|---|---|
| 1 | Gemini 3.1 Pro (preview) | `gemini-3.1-pro-preview` | **8, 8** | **0, 0** | $0.87 | 83 s | 51k |
| 2 | Gemini 2.5 Flash | `gemini-2.5-flash` | 5, 6 | 1, 1 | **$0.16** | 46 s | 49k |
| 3 | Gemini 3 Flash (preview) | `gemini-3-flash-preview` | 5, 5 | 0, 0 | $0.28 | 155 s (42 s, 267 s) | 72k |

**`qa-answer`** (the 18 calls answer one fixed set of questions per spec; found = deleted points answered false, of 15)

| Rank | Model | Model id | Found | Answered false but present (of 237) | Avg cost per run | Avg time | Output tokens |
|---|---|---|---|---|---|---|---|
| 1 | Gemini 3.1 Pro (preview) | `gemini-3.1-pro-preview` | 9, 10 | 20, 17 | $1.12 | 99 s | 72k |
| 1 | Gemini 2.5 Flash | `gemini-2.5-flash` | 9, 9 | 14, 17 | **$0.17** | **48 s** | 52k |
| 3 | Gemini 3 Flash (preview) | `gemini-3-flash-preview` | 9, 9 | **16, 13** | $1.81 | 872 s | 583k |

**`qa-generate`** (the model writes the questions from the plan; a fixed Pro answerer then answers them against the intact spec and each of the five variants)

| Rank | Model | Model id | Deleted points caught (of 15) | Questions written | Questions false on the intact spec |
|---|---|---|---|---|---|
| 1 | Gemini 3 Flash (preview) | `gemini-3-flash-preview` | **12** | 68 | 5 |
| 2 | Gemini 3.1 Pro (preview) | `gemini-3.1-pro-preview` | 10 | 70 | 9 |
| 3 | Gemini 2.5 Flash | `gemini-2.5-flash` | 8 | 86 | **2** |

What the columns mean:

- **Found / caught**: a deletion counts when the check reports that point as missing, or, for `qa-generate`, when at least one question that was true on the intact spec turns false on the variant.
- **Marked missing but present**: the check reported a point the spec does state. Each one costs a writer round. In `qa-answer` this count is dominated by the questions, which one model wrote from the plan once and which are shared by all three answerers, so it measures the questions as much as the answerer; the difference between the models is small next to it.
- **Cost**: token counts from the Vertex response (thinking tokens included in the output) at Google's list prices per million input/output tokens: $2/$12 for 3.1 Pro, $0.30/$2.50 for 2.5 Flash, and $0.50/$3 for 3 Flash (assumed). It is per run of 18 calls, not per plan. `qa-generate` is left out because it is three calls per model.

## What we read in it

- **`notes-check` needs the strong model.** Pro found 8 of 15 deleted points with no false alarm in both runs; the cheaper models found 5 or 6. 2.5 Flash costs a fifth as much, but it finds about a third fewer, and in one run a call returned nothing usable, so 28 points were never judged. This is the reverse of what we expected before measuring.
- **`qa-answer` is a tie on quality.** All three found 9 or 10 of 15 and raised a similar number of false alarms, so Pro's extra cost bought nothing here. 2.5 Flash is the cheapest and fastest, about a sixth of Pro's cost. 3 Flash is the worst choice: it thought for 500k to 670k tokens per run, so a run took nearly 15 minutes and cost more than Pro.
- **`qa-generate` favours the newer Flash.** 3 Flash caught 12 of 15 with fewer false alarms than Pro. 2.5 Flash wrote the most questions and the fewest false alarms but caught the fewest deletions.
- **No model finds everything.** The best result is 12 of 15, and `qa-answer` stops at 9 or 10. Deleting one line does not always remove the fact, because specs often state it twice (in a table and in a requirement), so some deletions are not detectable by any reader, and the ceiling is below 15. We did not check how many.
- **3 Flash is unpredictable in time.** One `notes-check` run took 42 seconds and the next 267; both `qa-answer` runs took about 870.

## What this suggests

| Station | Suggested model | Why |
|---|---|---|
| `spec-notes-check` | keep `gemini-3.1-pro-preview` | the only model that found 8; the others find a third fewer |
| `spec-qa-generate` | try `gemini-3-flash-preview` | caught the most, fewest false alarms of the two that caught 10 or more |
| `spec-qa-answer` | try `gemini-2.5-flash` after a pod test | same quality as Pro at a sixth of the cost, but see below |
| `spec-draft`, `spec-write` | keep `gemini-3.1-pro-preview` | not measured |

Nothing in the pipeline file has been changed. To switch a station, change `<agent>.settings.model` and its `prices` in `libs/assembly-lines/src/floor-pipelines/feature-planning.yaml`, and the `model` in `libs/shared/src/agent-defaults/<agent>.md` so the two copies agree.

The `qa-answer` suggestion is the shakiest. The [decompose comparison](decompose-model-comparison.md) found that `gemini-2.5-flash` often failed to write the file it was asked for, wrote the wrong path once, and reported success without a file once. These checks call the model directly and ask for JSON in the reply, so this benchmark could not see that failure. `qa-answer` must write `qa-answers.json` in a pod, so run it there before switching.

## How it was run

- **Specs**: `specs/context-evals/`, `specs/local-link-suggester/` and `specs/daily-digest/`, each as it stands on `main` in the repository.
- **Plan and ground truth**: a plan was derived from each finished spec by `gemini-3.1-pro-preview`: 14 items with a slot, a kind (paragraph, comment or question), the plan author's wording, and a verbatim quote of the one spec line that implements it (checked to appear exactly once; every item passed). For the variants the quoted line was deleted from the spec. For `qa-answer` the same model rewrote each plan item as one true-or-false statement, once, so every answerer saw the same questions.
- **Prompts**: condensed versions of the shipped prompts in `libs/shared/src/agent-defaults/`, which ask for the same judgment and the same JSON, with the spec and plan placed in the prompt. The agents ran as single model calls through the Vertex AI REST API (`gemini-cli` could not authenticate in this session), temperature 0.2 (0.3 for `qa-generate`, 0 for the fixed answerer).
- **Scoring**: a small script counted found, missed and false-alarm points against the known deletions.

## Limits

- **Not agent runs.** The pods read the repository, run shell commands and write files; these calls did none of that. In particular the technical check (that a named file exists on main) was not tested.
- **Synthetic plans.** The plans were written by a model from the finished specs, not by a team, so they match the specs unusually well and contain no stray comments or contradictions. Real plans may be harder, and the models might rank differently.
- **Two runs, or one.** `qa-generate` ran once, so its 12, 10 and 8 could move a place or two; the `notes-check` gap between Pro and the others was the same in both runs.
- **Detection ceiling.** See above: the true maximum is below 15 and unknown.
- **Pro wrote the plan and the questions and was the fixed answerer in `qa-generate`.** That could favour Pro's own style in `qa-answer`, though it did not win there.
- **Not run:** `gemini-2.5-pro` and `gemini-2.5-flash-lite` (the decompose comparison found both unreliable), and any Claude model. `gemini-3.1-flash-lite-preview` and `gemini-3.1-flash-preview` returned 404 on Vertex on this date.
- **The `spec-draft` and `spec-write` agents** have no measurement at all.
