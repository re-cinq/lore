# Five-pass review replay, 2026-11-19

**Keep five-pass review in shadow.** In this replay, both staged configurations identified real changes and test gaps that failed to reach a usable verdict. The completion markers and control cases kept both configurations below the promotion threshold.

## Trial results

Each cell records repeats 1–3 in order. A staged result is incomplete if any required pass lacks a successful completion marker.

| Case | Sonnet baseline | Full five-pass | Light first readers | Codex baseline |
| --- | --- | --- | --- | --- |
| Delegated captions | Changes / Changes / Changes | Incomplete / Incomplete / Incomplete | Incomplete / Incomplete / Changes | Changes / Changes / Changes |
| Monday reservation refusal | Changes / Changes / Changes | Changes / Incomplete / Incomplete | Incomplete / Incomplete / Incomplete | Approve / Approve / Approve |
| Mixed flyer and admission changes | Changes / Changes / Changes | Changes / Incomplete / Changes | Changes / Incomplete / Changes | Changes / Changes / Changes |
| Deferred calendar colours | Approve / Changes / Changes | Changes / Approve / Changes | Changes / Changes / Changes | Approve / Approve / Approve |
| Crate sizing refactor | Approve / Approve / Approve | Approve / Changes / Approve | Approve / Approve / Approve | Approve / Approve / Approve |

| Configuration | Expected verdicts | Critical blockers surfaced | False blockers | Incomplete |
| --- | ---: | ---: | ---: | ---: |
| Sonnet baseline | 13/15 | 9/9 | 2 | 0 |
| Full five-pass | 6/15 | 3/9 | 3 | 6 |
| Light first readers | 6/15 | 3/9 | 3 | 6 |
| Codex baseline | 12/15 | 6/9 | 0 | 0 |

Both staged configurations accounted for the independent flyer trim in their product readings, including trials that became incomplete. Both baseline reviewers surfaced the admission consequence and left the correctly tested trim unmentioned. The Codex baseline reported the missing Monday test in all three trials and approved with a suggestion each time.

I inspected the blocking findings in all 60 terminal responses, including product responses retained after an incomplete stage. A duplicate repeats the same blocking remedy in one findings array. Corroboration across stages and distinct code, test, or documentation remedies are excluded. There were zero duplicates among the 17 arrays with multiple blockers. Those arrays came from seven Sonnet baseline trials, six full five-pass trials, and four light-reader trials.

## Time and usage

| Configuration | Median elapsed | Median summed process time | Input tokens | Cache-read tokens | Cache-write tokens | Output tokens | Reported USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sonnet baseline | 16.1 s | 13.4 s | 45 | 15,638 | 12,603 | 11,466 | $0.25 |
| Full five-pass | 80.7 s | 90.5 s | 225 | 0 | 137,054 | 75,958 | $1.96 |
| Light first readers | 88.9 s | 82.4 s | 195 | 43,328 | 112,177 | 89,269 | $1.58 |
| Codex baseline | 6.2 s | 6.2 s | 345,178 | 215,680 | 0 | 1,969 | Unavailable |

Elapsed time includes waiting for a local replay slot. Summed process time counts concurrent reader processes independently. Each provider reports input and cache tokens using its own accounting. Claude Code reports cost estimates. Codex CLI did not report cost.

## Examples from the recorded readings

- **Venue regression.** Full trial 1 said the change was “allowing any active delegate to label any exhibit regardless of venue”. The intent comparison returned a complete payload and ended with `LORE_NODE_RESULT: {"outcome":"failed"}`. That marker routes the hosted run to incomplete.
- **Missing Monday test.** Full trial 1 reported “Required Monday test is absent” and supplied both observations in the distinguishing test: `expect(reserve('Monday',l)).toBe('closed'); expect(l).toEqual([]);`. Codex baseline trial 1 found the same gap, labeled it a suggestion, and emitted `REVIEW_RESULT:APPROVED`.
- **Mixed change.** Full trial 1 called the trim and its test “coherent and fully within the agreed scope” before reporting the separate admission-price regression. A passing age-nine test cannot distinguish whether children aged 10 and 11 pay.
- **Deferred colours.** Full trial 1 said “Category colours explicitly deferred — acknowledged scope decision”. The same trial made absent-room behavior a blocker while saying “the correct behavior cannot be inferred from the existing spec or discussion.” The fixture contains no caller that omits a room. The replay scores this as an unsupported blocker and leaves the absent-room behavior open.
- **Clean refactor.** Light trial 1 said “The arithmetic is identical before and after” and approved the named divisor. Full trial 2 claimed “Math.ceil(-1/6) returns positive 0, not -0” from its challenge and blocked the refactor on a failing assertion. Node returns true for `Object.is(Math.ceil(-1 / 6), -0)`.

## Cases and scoring

The synthetic fixtures include production excerpts, tests, a human scope discussion, and the base product promise. Fixture expectations were written before launching the trial processes. Each arm ran the same five fixtures three times. [Fixture definitions](../../scripts/review-pilot/cases.mjs)

| Case | Expected result | Evidence that earns credit |
| --- | --- | --- |
| Delegated captions | Request changes | An active delegate from the west venue can publish a caption for an east exhibit through the unchanged caller. The existing same-venue test passes both versions. |
| Monday reservation refusal | Request changes | The implementation rejects Mondays correctly. The agreed regression test is missing. It must assert both the `closed` outcome and an empty ledger. |
| Mixed flyer and admission changes | Request changes | The heading trim works and has a matching test. The separate threshold change charges ages 10 and 11 despite the free-admission promise. |
| Deferred calendar colours | Approve | Room names ship now, the title remains visible, and the calendar owner explicitly deferred colours. |
| Crate sizing refactor | Approve | Extracting the constant preserves behavior. The existing assertions cover zero, exact capacity and overflow. |

The three expected blockers count only when the trial provides the specified consequence and requests changes. A pass must report complete in its payload and emit a success marker. Incomplete trials earn no blocker credit. The replay retains downstream readings for diagnosis even when an earlier marker would stop the hosted sequence. A blocking verdict on either control is a false blocker. A correct verdict can still omit evidence required by a case, such as the independent flyer change or the explicit scope decision.

## Replay method

The pilot froze the production baseline prompt and the five shadow prompts, including the shared reader skill, before constructing the cases. Each invocation used a fresh process with an empty working directory. The replay supplies each stage's file inputs through JSON on stdin. It feeds the original readings into the later stages and leaves intent and product evidence out of all three blind readings. [Prompt checksums](../../scripts/review-pilot/prompts/SHA256SUMS) · [Replay harness](../../scripts/review-pilot/run.mjs)

The baseline uses a single process and the production baseline prompt, with a local adapter for evidence and final output. Its controlled replay model is Claude Sonnet 4.6. The full arm uses Sonnet 4.6 at medium effort for each stage. The light arm changes only the code and test readers to Claude Haiku 5.5 at low effort. The supplemental baseline runs the same baseline prompt with Codex and GPT-6.1 Terra at low effort.

The hosted product prompt has since been revised to assess changed Markdown that the product consumes, including agent prompts and UI content. The replay uses the frozen prompt with its recorded checksum.

The replay used Claude Code 2.1.325 and Codex CLI 0.165.0. The production baseline is configured for Gemini 4 Argon. This local replay measures the listed configurations using synthetic fixtures. A hosted pilot exercises the actual baseline model, data collection, Floor stage orchestration and GitHub lifecycle.

## Reproduce the replay

Run from the repository root with Claude Code and Codex CLI authenticated. Provide new output files. Each line contains one trial's verdict, process timings, available token usage and original model responses.

```sh
node scripts/review-pilot/run.mjs /tmp/lore-five-pass-replay.jsonl
PILOT_CODEX_BASELINE=1 node scripts/review-pilot/run.mjs /tmp/lore-five-pass-codex.jsonl
node scripts/review-pilot/score.mjs /tmp/lore-five-pass-replay.jsonl /tmp/lore-five-pass-codex.jsonl
```
