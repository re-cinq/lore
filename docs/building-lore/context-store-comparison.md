# Which store answers context questions best

**For people deciding where Lore's knowledge should live.** This records the side-by-side comparisons of Lore's own stores and Utopia as the source of the context an agent gets: the first run of 2026-10-16, the re-runs of 2026-10-19, the agent-question experiment of 2026-10-27, the ticket grade and the reader change of 2026-10-31, and what they say about the switch. The latest evidence favours Utopia; the first run, which does not, was taken before its data was in place.

## Where this stands (2026-10-31)

Utopia is ahead of Lore on the evidence so far, with two caveats, and since 2026-10-31 its assembly reads six sections instead of two.

- **Document questions, same 20 documents before and after the readers (2026-10-31):** Utopia answered 15 then 19 of 20 on lore, 16 then 18 of 20 on Otto, level with Lore; it found 20 of 20 and 19 of 20. Its assembly took 24 to 26 s median against Lore's 1.3 to 1.7 s, with Utopia's database saturated by its own extraction queue, and the useful share did not move. Details below.

- **Agent questions (2026-10-27, 60 questions, 3 asks each):** Utopia scored 0.86 against Lore's 0.57 and 0.07 with no store. It was ahead on seven of eight kinds of question and behind only on decisions (Lore 0.93, Utopia 0.90, one question's worth, inside the noise). On what changed since the two are level in practice (0.58 against 0.53) and both poor.
- **Document questions (2026-10-19, 121 documents):** Utopia found 120 and answered 117, Lore 104 and 110.
- **Caveats:** the 10-27 run is one day, one answering model and 4 to 10 questions per kind, with a hallucination rate of 7 to 9% for Utopia. The switch rule in the plan, Utopia at least as good for two weeks running, is not met yet because there is one day of agent-question data. The next step is to repeat the runs, then switch the stores where Utopia is level or ahead.

The numbers below were recomputed on 2026-10-28 from the per-answer judgements in re-cinq/loop-bench `results/context-qa/2026-10-27/`, and match.

## Why we measured

Lore keeps its knowledge in its own stores: a Dgraph trace graph, pgvector chunks and a memory schema. Since ADR-052 it also mirrors each repository's specs, ADRs, test runs and code links into a Utopia knowledge base. The plan is not to move by decree. Every ingest writes to both stores, every read can name the store it reads from (`backend: lore | utopia | both`), and a store is switched to Utopia only once the context evals show Utopia answering at least as well for that kind of data, two weeks running.

Three measurements have been taken so far. The first, on 2026-10-16, ran before most Utopia bases were filled and is superseded by the two after it.

## Agent questions on 2026-10-27: Utopia ahead on every kind but one

The runs above ask questions a model writes from one ADR or spec, answered by a lore-api model from one assembled block. On 2026-10-27 a different experiment asked a real agent the questions people ask: why a decision was made, which file does something, which pull request changed it, what changed since. There were 60 questions with hand-checked gold answers, 30 about re-cinq/lore and 30 about re-cinq/Otto. Each was asked three times of a fresh Claude (`claude-sonnet-5-5`) that had no instructions, no file access and only one MCP server: none, Lore's adapter, or Utopia's MCP route for the repository's base. A second fresh Claude (`claude-opus-5-5`) judged each answer against the gold answer.

| Arm | Score | Hallucinated | Tokens p50 | Cost per question | Time p50 / p95 |
|---|---|---|---|---|---|
| no MCP | 0.07 | 0% | 2,731 | $0.011 | 2.6 s / 8.1 s |
| Lore | 0.57 | 10% | 49,421 | $0.080 | 16.3 s / 42.8 s |
| Utopia | **0.86** | 7% | 17,794 | $0.036 | 24.8 s / 70.9 s |
| Utopia, after that evening's search fix | 0.85 | 9% | 17,813 | $0.034 | 14.4 s / 51.3 s |
| Utopia, at the night's search speed | 0.84 | 8% | 17,800 | **$0.023** | **8.8 s / 30.6 s** |

| Kind | Lore | Utopia |
|---|---|---|
| decision (ADRs) | **0.93** | 0.90 |
| requirement (specs) | 0.52 | **0.87** |
| code location | 0.48 | **0.69** |
| commit history | 0.54 | **0.96** |
| issues and pull requests | 0.04 | **1.00** |
| learned gotchas | 0.78 | **0.89** |
| superseded decisions | 0.53 | **0.58** |
| unanswerable | 0.92 | **1.00** |

- **Utopia answered more, for less.** Paired on the same questions, Utopia was better on 32, worse on 7 and level on 21 (exact McNemar p < 0.001). It used about a third of Lore's tokens and was more consistent: 85% of questions got the same verdict all three times, against 62% for Lore.
- **The widest gaps are data Lore's tools cannot reach.** Utopia's `github` and `git-history` sources answer "which pull request" and "when did this change" in one search. Lore's agent finds the decision and then says, correctly, that nothing it can search names the pull request.
- **Both stores repeat stale documents.** Most wrong answers came from a text overtaken by an amendment or a later pull request. One of them was this repository's own ADR-010, which still called the context evals nightly after #2823; it is amended in the same change as this section.
- **Utopia's search was the cost.** At first a search on lore's base took 83–118 s: the Utopia database had no approximate-nearest-neighbour index, and its 3072-dimension embeddings are above pgvector's HNSW limit. That run needed `MCP_TOOL_TIMEOUT` raised to 5 minutes. After the evening fix, searches took about 12 s and the default timeout sufficed.
- **Limits:** one run on one day with one answering model, 4–10 questions per kind, the Lore arm on the laptop's installed adapter, and the arms run hours apart.

The full write-up, with every question and every ask as raw data: [context-store-agent-questions.md](context-store-agent-questions.md). Harness and transcripts: re-cinq/loop-bench `results/context-qa/2026-10-27/`, from re-cinq/loop-bench#1.

## Readers for memories, code and tests, 2026-10-31: Utopia answers more, and slower

Until this day the Utopia arm of `lore_assemble_context` filled two of the eight template sections, Conventions and ADRs, from the `docs` source, and rendered the other six as the line `<source>: no Utopia reader yet`. Story #4025 added the readers: the memories and episodes sections from the memory search (#4034), the Relevant Code and Coupled Spec & Tests sections from the `test-coverage` source (#4043), the placeholder lines dropped (#4030), a `Status:` and `Amended:` header on every mirrored document (#4044), `lore_search_context` reading the docs source (#4042), a 45 s gateway timeout with one retry in place of 15 s and four (#4036), and a ticket-shaped eval mode (#4032). All but #4042 were live by 02:00 UTC on 2026-10-31.

### Document evals, the same 20 documents before and after

`run.mjs --backend both --sample 20 --date 2026-10-31`, so both runs asked about the same documents; the "before" ran at 00:40 UTC, the "after" at 02:10 UTC.

| Repo | Store | Found | Answered | Useful share | Utopia assembly p50 |
|---|---|---|---|---|---|
| lore, before | Lore | 15 / 20 | 17 / 20 | 58% | 1.7 s |
| lore, before | Utopia | 18 / 20 | 15 / 20 | 51% | 4.2 s |
| lore, after | Lore | 16 / 20 | 19 / 20 | 63% | 1.3 s |
| lore, after | Utopia | **20 / 20** | **19 / 20** | 52% | 24.3 s |
| Otto, before | Lore | 16 / 20 | 20 / 20 | 70% | 1.2 s |
| Otto, before | Utopia | 19 / 20 | 16 / 20 | 68% | 3.4 s |
| Otto, after | Lore | 17 / 20 | 20 / 20 | 59% | 1.7 s |
| Otto, after | Utopia | 19 / 20 | **18 / 20** | 54% | 26.2 s |

Three things to read off it:

- **Utopia now answers as often as Lore.** On lore the two stores answer 19 of 20 each, and Utopia finds every document; on Otto Utopia went from 16 to 18 answered. The two documents it still misses are a question whose answer is in a sentence the excerpt cut (`support-agent-conversation-history`) and one where the search returned nothing (`support-agent-foundation`), the "whole requirement" problem of #4021.
- **The useful share did not move.** More sections in the same 8,000-token budget means more of the block is about something else. The judge of the ticket grade below says the same thing in words.
- **Utopia's assembly got six times slower**, and 8 of lore's 20 and 9 of Otto's 20 Utopia assemblies hit the 30 s search timeout. An assembly now runs three Utopia searches instead of one (the docs source, the repo's memory base, the org's memory base), and Utopia's database sat at 3.4 cores through the run: its job queue held 52,000 `extract_document` and 108,000 `resolve_time` jobs, the extraction over the tracker and history sources that #4039 switches off for new pushes. The 45 s gateway limit of #4036 lets a slow answer reach a pod; the fix is on Utopia's side, in the queue and in a search that filters by source instead of returning 50 hits for Lore to sift.

### The ticket grade

The document evals ask a question a model wrote from one document. To grade the block an implementer is handed, 8 real `priority:*` tickets per repository were assembled with the `implementation` template and the ticket as the query, once per store, and a judge scored each block 0 to 3: nothing relevant, generic background, one ticket-specific fact, several an implementer would otherwise dig for. The first grade used a fresh `claude-sonnet-5-5` on a laptop (00:50 UTC, before the readers); the mode now ships as `run.mjs --tickets 8 --backend both` (#4032), judged inside lore-api by `Llm.for("eval")`, which on this deployment is `gemini-2.5-flash`.

| Repo | Judge, when | Lore mean | Utopia mean | Lore block | Utopia block | Utopia p50 |
|---|---|---|---|---|---|---|
| Otto | Sonnet, before the readers (00:50) | 2.63 | 2.63 | 22 to 34k chars | 3.5 to 10k | 2.9 s |
| Otto | Sonnet, after (02:40) | 2.43 | **2.71** (7 tickets; the eighth assembly failed on a dropped connection) | 20 to 34k | 10 to 31k | 4.1 s |
| lore | Sonnet, before (00:50) | 2.63 | 2.00 | 9 to 33k | 9 to 13k | 4.0 s |
| lore | Sonnet, after (02:40) | 2.50 | **2.88** | 9 to 32k | 25 to 35k | 12.1 s |
| both | `gemini-2.5-flash` in lore-api, after (02:25) | 3.00 | 3.00 | | | |

The same tickets, the same judge, the same scale: Utopia went from behind (2.00) to ahead (2.88) on lore and from level to ahead on Otto, while Lore's own score drifted down by one ticket's worth on each, which is the judge's noise between two runs. The two Utopia blocks the judge scored lowest are the two that hit the 30 s search timeout and came back with the Conventions and coupling sections only.

What the Sonnet judge named useful, before the readers, split cleanly by store: Lore won through the code, test-coupling and memory sections ("`board.ts` already has `pausedNotice`", "`securityHeaders.test.ts` expects exactly CSP, nosniff and no-referrer"), which Utopia rendered as placeholders; Utopia won on the exact wording of the spec statement the ticket named, in a quarter of the text. Its noise line named the six placeholder sections on every Utopia block and other tickets' DoD memories on every Lore block. After the readers a Utopia block carries Conventions, Coupled Spec & Tests, memories and episodes (21 to 35k characters, from 3 to 10k); the Relevant Code section stays empty under Utopia for a ticket query, because a `code:` item only surfaces when the query names its file or a symbol, as the code-location questions of 10-27 did.

The in-API judge scored every ticket 3 for both stores on both repositories, so it separates nothing; a grade that saturates is not a measurement. The next change to #4032 is a stricter scale or a stronger judge model, measured against the Sonnet numbers above.

## Re-run on 2026-10-19: the gap was missing data

By 2026-10-19 every onboarded repository had a Utopia base at ontology version 5 or 6, HALEngine's base was full, and Utopia ran `0.1.0-re.14`. The eval now records every returned source with its section, its tokens and whether the answer used it (#2812, `run.mjs --results`). The same 121 documents were asked four times (sample date pinned to 2026-10-19), changing one thing each time:

| Run | Lore found | Lore answered | Lore useful | Utopia found | Utopia answered | Utopia useful | Utopia assembly p50 |
|---|---|---|---|---|---|---|---|
| Baseline (re.14) | 104 | 110 | 64% | **120** | **117** | 65% | 0.8 s |
| A Utopia document capped at its 3 best hits (#2813) | 104 | 109 | 64% | 120 | 111 | 50% | 0.8 s |
| … and the search scoped to `doc:`/`stmt:` items (#2814, re.15) | 104 | 109 | 64% | 69 | 64 | 27% | 30 s (timeout) |

- **Utopia now finds and answers more than Lore.** The 10-16 gap came from bases that were missing or half-filled, not from Utopia's ranking. Per repository Utopia is level with Lore or ahead everywhere; its one weaker number is useful share on bowman-ui (53% against Lore's 82%).
- **Utopia hands back smaller sources, used about as often.** Median tokens per source: Utopia 178, Lore 229. The share of tokens the answer used per section: Utopia `repo` 62%, `adrs` 68%; Lore `repo` 65%, `code` 51%, `adrs` 79%, `memories` 6%.
- **Capping a document at its best three statements hurt** (answered 117 to 111): the statement that answers a question is often not among those that matched it best. Reverted (#2817).
- **Scoping the search before recall made it time out.** For a big repository the allowed set is nearly every document of its statements source, which the vector channel cannot filter cheaply. Reverted on Lore's side (#2820); re.15 without the scope fields searches as re.14 did.
- **Lore's own misses on re-cinq/lore are mostly not retrieval misses.** Twice it answered from current code (a third theme family) that the reference documents never mention, and once it cut ADR-039 before the amendment that reverses it.

## First run, 2026-10-16: Utopia bases missing or half-filled (superseded)

On 2026-10-16 seven of the twelve onboarded repositories had a Utopia base, and several were only part filled, so the Utopia columns below measure missing data as much as ranking. The evals sample up to 20 ingested ADRs and specs per repository. For each document, a model writes a question the document answers. Context is then assembled for that question twice, once from Lore and once from Utopia, each at the full budget, and each assembly is graded against the same question.

| Repository | Docs | Utopia base | Lore found | Lore answered | Lore useful | Utopia found | Utopia answered | Utopia useful | Answered by Lore alone | Answered by Utopia alone | Source overlap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bowman-ui | 20 | yes (v2) | 15 | 19 | 81% | **18** | 19 | 54% | 0 | 0 | 12% |
| lore | 20 | yes (v3) | 16 | 19 | 58% | 8 | 8 | 31% | 11 | 0 | 7% |
| Otto | 18 | yes (v2) | 17 | 14 | 64% | 4 | 8 | 35% | 7 | **1** | 2% |
| HALEngine | 20 | yes (v2) | 20 | 20 | 72% | 0 | 6 | 22% | 14 | 0 | 2% |
| re-plan | 4 | yes (v2) | 4 | 4 | 75% | 1 | 2 | 35% | 2 | 0 | 2% |
| demo-factory-todo | 1 | yes (v2) | 1 | 0 | 0% | 0 | 0 | 0% | 0 | 0 | 0% |
| CFOAgent | 20 | yes (v2) | 17 | 18 | 64% | 2 | 11 | 38% | 7 | 0 | 2% |
| ai-agent-subsystem | 3 | no | 3 | 3 | 97% | 0 | 0 | 0% | 3 | 0 | 0% |
| the-expert-api | 4 | no | 3 | 3 | 41% | 0 | 0 | 0% | 3 | 0 | 0% |
| the-expert-admin-api | 4 | no | 4 | 3 | 27% | 0 | 0 | 0% | 3 | 0 | 0% |
| the-expert-ui | 4 | no | 4 | 4 | 73% | 0 | 0 | 0% | 4 | 0 | 0% |
| website-cf | 3 | no | 1 | 2 | 93% | 0 | 0 | 0% | 2 | 0 | 0% |

What the columns mean:

- **Found**: the assembled context included the document the question was written from.
- **Answered**: a model, given only the assembled context, answered the question, judged against the document.
- **Useful**: the share of the assembled context the judge found relevant to the question.
- **Answered by … alone**: questions one store's context answered and the other's did not.
- **Source overlap**: the Jaccard overlap of the two assemblies' source paths, averaged over the documents.
- **Utopia base**: whether the repository has a Utopia knowledge base (`settings.utopia`), and the ontology version it was last upgraded to.

## What the first run suggested, and what the later runs showed

- **Where Utopia has the data, it already finds the right document.** On bowman-ui it found more source documents than Lore (18 against 15) and answered as many questions (19).
- **Less of what Utopia returns gets used.** Its useful share is roughly half of Lore's wherever it answers at all. Useful share is a precision measure: the tokens of the sources the answer used, over all tokens returned. On CFOAgent it answered 11 questions while finding only 2 of their documents, so its answers came from neighbouring statements rather than the source. The cause is not known yet. It is *not* the size of an item: a check after this run showed the Utopia reader already returns only the statements its search matched (one statement per hit, section text dropped). The likelier suspects are ranking and recall: one search returns up to 50 statements across all sections, and a document that matched on one weak statement still takes a slot. The eval does not yet record each source's size, which is what would tell these apart.
- **Utopia almost never answers what Lore cannot.** Across the run Utopia answered one question Lore missed (on Otto); Lore answered 56 that Utopia missed.
- **The two stores rarely pick the same sources.** Overlap stays between 0% and 12%. Even on bowman-ui, where both find most documents, they keep different neighbours, which suggests the ranking differs a lot (Utopia ranks statements by its hybrid search; Lore ranks chunks by its own).
- **HALEngine is a real gap, not a missing base.** It has a Utopia base, but Utopia found none of its 20 documents while Lore found and answered all 20. Why is not known yet; the first thing to check is whether its documents reached the mirror whole (the base is on ontology version 2).
- **Five repositories have no Utopia base at all**, so their Utopia columns are zeros by construction; the weekly backfill only mirrors repositories that already have a base.
- **The run also flagged Lore itself.** Otto falls below the evals' bar on Lore's own numbers (14 of 18 answered against a bar of 85%), and demo-factory-todo's single document goes unanswered. Both are Lore findings, independent of Utopia.

All of the above was read from a run in which five bases did not exist and HALEngine's was empty. The 2026-10-19 re-run, with every base in place, reversed the central readings: Utopia found 120 of 121 documents against Lore's 104, and HALEngine's gap was the missing mirror, not ranking.

## How the first run was run

- **Where**: the runner (`scripts/context-evals/run.mjs --backend both --sample 20`) ran on a developer machine against the deployed lore-api (`https://lore-api.gcp.re-cinq.com`), four repositories at a time. The deployed lore-api was at the merge of #2794, the first Utopia reader, and Utopia was release `0.1.0-re.7`. Models, assembly and grading all ran inside lore-api; the machine only drove the requests.
- **Documents**: the runner lists the repository's ingested ADRs and specs that still exist (`GET /api/context-evals/documents`) and samples up to 20 with a sampler seeded by the date, so every run on the same day picks the same documents.
- **Per document** (`POST /api/context-evals` with `backend: "both"`, #2792):
  1. The eval model (`Llm.for("eval")`, temperature 0) writes one question from the document's ingested text, cut at 12,000 characters.
  2. Context is assembled for that question twice, one after the other and each timed: from Lore (`assembleContext`, the `default` template and its usual budget, what `lore_assemble_context` hands an agent) and from Utopia (the same call with `backend: "utopia"`).
  3. For each assembly, the model answers the question from that context alone and lists the sources it used.
  4. A judge (`LORE_EVAL_JUDGE_MODEL`, or the eval model) compares the answer with the document. A claimed contradiction counts only when the sentence it quotes is really in the document.
- **The Utopia arm** (#2794): the `repo` and `adrs` sections come from one search of the repository's Utopia knowledge base, keeping the statements source's `doc:` and `stmt:` items and grouping them by document. Every other section (code, memories, the graph, incidents) answers "no Utopia reader yet", so it contributes nothing.
- **Verdict**: the runner's pass or fail reads Lore's numbers alone (85% answered); Utopia is under evaluation and cannot fail it.
- **Utopia bases**: read from each repository's settings at the time of the run.
- **A second look**: the same comparison had run once in CI a few minutes earlier on the same day, so on the same documents. The two runs agree within a few documents per repository (for example lore: Utopia found 9 then 8; bowman-ui: Lore found 16 then 15), which is the noise to expect from regenerated questions and model answers.

## Limits

- **One question per document in the document evals.** The sample is drawn per day, so a run on another day asks about different documents. Single-repository numbers move by a few documents between runs, as the CI run beside the first run showed.
- **Small repositories.** Six repositories have four or fewer sampled documents; their rates are not meaningful on their own.
- **Document evals compare unequal assemblies.** In the 10-16 and 10-19 runs Utopia's reader covered only the specs and ADRs sections, against Lore's full assembly. They say how far Utopia was from replacing Lore on documents, not how good each store is at the same job. The agent-question run is the fairer comparison of what an agent gets, and it favours Utopia on code location (0.69 against 0.48) and learned gotchas (0.89 against 0.78) as well.
- **The agent-question run is one day.** One answering model, 4 to 10 questions per kind, the Lore arm on the laptop's installed adapter, and the arms run hours apart.
