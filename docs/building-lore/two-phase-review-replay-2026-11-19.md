# Does a second review pass catch what a single pass misses?

**Pilot decision, 19 November 2026.** Keep the two-phase line in shadow mode. It caught a real change to user-visible behavior that the single-pass reviewer approved three times. It also treated a deliberately removed refusal test as a blocker in all three runs. Both approaches missed a confirmed parser defect in a larger change. The new line requested changes on 18 of 21 reviews, including all three reviews of the repaired parser.

## Seven snapshots, three repetitions each

“Blocked” counts reviews that requested changes for **any** reason. The last column says whether the reviewer identified the behavior we were measuring. Each row used a fresh process for every reading, solution review, coverage review, and single-pass comparison.

| Snapshot | Single pass blocked | Two phases blocked | What the reviews established |
| --- | ---: | ---: | --- |
| [#739, ingestion cutover and stylesheet classification](https://github.com/re-cinq/lore/pull/739) | 3/3 | 3/3 | **0/3 for both** on a Cobertura parser that silently dropped a covered line when two attributes changed order. Both found a separate, real defect where a failed database insert was acknowledged as a successful report. |
| [#4640, parser repair](https://github.com/re-cinq/lore/pull/4640) | 3/3 | 3/3 | The original ordering defect was repaired and had an assertion. Reviewers nevertheless blocked on hypothetical XML attributes without identifying a supported producer that emitted them. One coverage run also requested a test one layer higher for behavior already exercised at the format dispatcher. |
| [#1400, transcript deduplication](https://github.com/re-cinq/lore/pull/1400) | 3/3 | 3/3 | Two coverage runs found a concrete gap. The tests could pass if the production database adapter discarded the deduplication key, because the integration fixture used its own SQL. Reviewers also raised a compatibility limitation already accepted in the spec. Billing and event deduplication were expressly deferred. [Scope decision](https://github.com/re-cinq/lore/issues/1394) |
| [#4896, credential validation as merged](https://github.com/re-cinq/lore/pull/4896) | 0/3 | 3/3 | The specific rotation refusal test **exists**. No coverage run called it missing. All three requested additional startup or transport coverage. Those boundary tests are distinct from the existing validator tests. A missing boundary test alone does not demonstrate a broken production guard. |
| #4896 with one negative test removed | 0/3 | 3/3 | Identical production code. **3/3 coverage reviewers** explained which invalid credential pair could go untested and requested an assertion. All three single-pass reviewers noticed a stale test citation and approved. The surviving citation made this gap easier to find. |
| [#4951, described as a schema-only refactor](https://github.com/re-cinq/lore/pull/4951) | 0/3 | 3/3 | All three solution reviewers found an unrelated status change from *Implemented* to *In Progress*. That changes how the feature appears in the spec browser. All three single-pass reviewers approved, as did Lore on the actual PR head. [Original review](https://github.com/re-cinq/lore/pull/4951#pullrequestreview-5966520724) |
| Clean control · #4951 with the original status restored | 0 of 3 requested changes | 0 of 3 requested changes | Both approaches approved the clean schema move three times. The moved schema declarations match the original block byte for byte. |

The parser miss was checked independently after the reviews. We ran the historical Go parsing functions and their original unit tests with an additional assertion for the reversed attributes. The original tests passed on both heads. The additional assertion returned no covered line on #739 and the expected line on #4640. The old implementation also had the limitation. This was a missed defect in the replacement path. [Issue #3627](https://github.com/re-cinq/lore/issues/3627)

We selected #4951 expecting a clean control. The reviewer exposed the status change, which the diff confirmed, so we added a second checkout with just that hunk restored. The credential-validation example exercises a different contract from the ADR-053 UI incident.

## What an author would have seen

The first code-only comment from the #4951 replay read:

> The plan detail spec now appears as “In Progress” instead of “Implemented.” It will move from the shipped category to the in-progress category in status-based views and filters.

After it read the PR description, the solution reviewer requested changes on the status line with the subject **“Keep the lifecycle status out of this schema-only refactor.”** The coverage reviewer credited the unchanged schema tests. This catches the discrepancy, but the opening comment omits the main change the author proposed.

The same problem appeared in all three first readings of #739, #1400, and #4640. Each used its two sentences on one failure scenario. In a separate, unscored experiment we asked a **maintainer explaining the change** to name the main before-and-after and any independent second change, saving suspected defects for the review. All four fresh processes then described the main change. The #1400 comment read:

> Re-sending a local task transcript now skips turns already stored instead of adding duplicate transcript rows, and operators get a warning and count for skipped turns. This applies to relayed turns with matching keys; cluster-produced turns without keys are still stored as before, and cost and visualization records are not deduplicated.

## What to change before gating merges

1. **Give the initial comment a neutral authoring role.** Ask it to take stock of the entire diff before writing. Preserve the requirement to publish its reading before comparing it with the ticket, PR description, and discussion.
2. **Review each independent behavior in a mixed PR.** On #739 both reviewers spent their finding budget elsewhere. Record each changed behavior and its relevant test evidence before selecting what to post. A green CI run and a good finding elsewhere both leave an unexamined parser unexamined.
3. **Require evidence for blocking severity.** A test-gap blocker should name a plausible wrong implementation that the existing suite would accept and a supported caller or input that would experience the consequence. If a reviewer wants a higher-level test, it should identify what could break between the existing assertion and the real entry point. Explicitly accepted tradeoffs can be surfaced for reconsideration with their original decision attached.
4. **Repeat on fresh, undisclosed cases.** These historical examples can now serve as calibration. Include another large mixed change, a correct fix without a dangling test citation, a harmless move, and a sanitized delegation case from the original auth incident. Check the effective production model and line before enabling enforcement.

## How the replay ran

We archived each real GitHub PR head, diffed it against its merge base, and verified the changed path list against GitHub. Code readers received the checkout and diff. Later stages received available ticket and PR text, discussion and review threads through merge time, and recoverable CI metadata. Earlier human and bot reviews could therefore cue those stages. The synthetic variants had no verified CI run. The coverage process received no outputs from the replay's first reviewer. Either phase requesting changes set the combined verdict. This exercised reviewer decisions and simulated their GitHub output locally. Posting, retries, thread reconciliation, rechecks and auto-merge need a live pilot.

The 21 comparisons used **84 separate Codex CLI processes** with `gpt-6.1-terra`, medium reasoning, read-only shell access, and up to four findings per review stage. The neutral-writing experiment added four processes. The single-pass comparator adapted the shipped review instructions to the same CLI, checkout, historical context, and structured output. Production uses its configured floor model. Some local summaries picked up personalized CLI wording; that would need filtering or an isolated production profile before posting.

Median local process time per snapshot was **29 seconds** for one pass and **65 seconds** summed across the three proposed stages, excluding queue time. Median reported input tokens, including cached tokens, were 207,697 and 529,013 respectively. Billed cost was unavailable. Five real PRs and two derived controls were selected for diagnostic value. Repeating the same snapshots measures consistency on those examples. It does not establish a production detection rate.

## Hosted rehearsal on the queue fixture

The manual line ran twice against an isolated local Floor API and database. Local Claude Code workers read the Floor visit briefs, fetched the files with visit tokens, and returned the model output through the Floor sink. In both runs the Floor joined a concurrent duplicate, gave each reader one evidence packet and a fresh conversation, then retained all three output artifacts. A follow-up run used three real pods on a disposable Kubernetes cluster. Each pod fetched the catalogue skill through Lore’s gateway and read its evidence file. The floor saved all three artifacts. The code reading followed the changed default into the unchanged queue caller, the test reading identified the mock, and the challenge gave a 50-item input with distinguishable outcomes of 25 and 50. The intent passes must still decide which outcome the product promises.

Sonnet at low effort and the Claude Code `haiku` alias at low effort both followed the 25-to-50 change into the unchanged queue consumer and identified the test mock that fixes the size at 25. The challenge stayed on Sonnet in both runs. One challenge proposed an impossible 50-item expectation for a 30-item input. The distinguishing outcomes for that input are 25 and 30. The reader instructions now require checking both outcomes for the proposed input. This single case provides an initial comparison. The fresh cases and repeats in the pilot still determine model selection.

### Focused parser replay

We then used the shared runner on the parser and tests from #739 and #4640, with one run per configuration. Both configurations used low effort. One used Sonnet for passes 1 and 2 and the other used Haiku. Pass 4 stayed on Sonnet for both. Each packet was limited to the parser, report caller and their tests.

On #739, the Sonnet test reading noted the missing attribute-order case. One independent Sonnet challenge found the concrete loss of a covered line when the XML attributes were reversed. Its other run missed that failure. The Haiku test reading described the existing assertions and omitted the order gap. On #4640, both model configurations recognized the parser change and the acceptance test for reversed attributes. Both challenges still suggested additional cases after seeing that acceptance test.

The results show variation even with a fixed challenge model. These two historical cases are useful controls for the pilot. Model selection still depends on repeated runs with fresh cases and a consistent severity rubric.
