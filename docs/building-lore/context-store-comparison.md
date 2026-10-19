# Which store answers context questions best

**For people deciding where Lore's knowledge should live.** This records the side-by-side comparisons of Lore's own stores and Utopia as the source of the context an agent gets: the first, run on 2026-10-16, and the re-runs of 2026-10-19 (below), and what they say about the switch.

## Why we measured

Lore keeps its knowledge in its own stores: a Dgraph trace graph, pgvector chunks and a memory schema. Since ADR-052 it also mirrors each repository's specs, ADRs, test runs and code links into a Utopia knowledge base. The plan is not to move by decree. Every ingest writes to both stores, every read can name the store it reads from (`backend: lore | utopia | both`), and a store is switched to Utopia only once the context evals show Utopia answering at least as well for that kind of data, two weeks running.

This is the first run of that measurement. The Utopia side is young: it has one reader so far, and Utopia knowledge bases exist for only seven of the twelve onboarded repositories.

## Results

The evals sample up to 20 ingested ADRs and specs per repository. For each document, a model writes a question the document answers. Context is then assembled for that question twice, once from Lore and once from Utopia, each at the full budget, and each assembly is graded against the same question.

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

## What we read in it (2026-10-16)

- **Where Utopia has the data, it already finds the right document.** On bowman-ui it found more source documents than Lore (18 against 15) and answered as many questions (19).
- **Less of what Utopia returns gets used.** Its useful share is roughly half of Lore's wherever it answers at all. Useful share is a precision measure: the tokens of the sources the answer used, over all tokens returned. On CFOAgent it answered 11 questions while finding only 2 of their documents, so its answers came from neighbouring statements rather than the source. The cause is not known yet. It is *not* the size of an item: a check after this run showed the Utopia reader already returns only the statements its search matched (one statement per hit, section text dropped). The likelier suspects are ranking and recall: one search returns up to 50 statements across all sections, and a document that matched on one weak statement still takes a slot. The eval does not yet record each source's size, which is what would tell these apart.
- **Utopia almost never answers what Lore cannot.** Across the run Utopia answered one question Lore missed (on Otto); Lore answered 56 that Utopia missed.
- **The two stores rarely pick the same sources.** Overlap stays between 0% and 12%. Even on bowman-ui, where both find most documents, they keep different neighbours, which suggests the ranking differs a lot (Utopia ranks statements by its hybrid search; Lore ranks chunks by its own).
- **HALEngine is a real gap, not a missing base.** It has a Utopia base, but Utopia found none of its 20 documents while Lore found and answered all 20. Why is not known yet; the first thing to check is whether its documents reached the mirror whole (the base is on ontology version 2).
- **Five repositories have no Utopia base at all**, so their Utopia columns are zeros by construction; the weekly backfill only mirrors repositories that already have a base.
- **The run also flagged Lore itself.** Otto falls below the nightly bar on Lore's own numbers (14 of 18 answered against a bar of 85%), and demo-factory-todo's single document goes unanswered. Both are Lore findings, independent of Utopia.

## What this suggests

No store should switch yet. The plan's rule is two weeks of Utopia matching Lore, and today Utopia trails on every repository except on finding bowman-ui's specs. The next steps, in order of what they should move:

1. **Set up Utopia bases for the five repositories without one**, then backfill, so every row compares two stores rather than one.
2. **Measure where the unused tokens come from.** Record each source's size in the eval's output, then test a per-document score floor or a cap on statements per document in the Utopia reader.
3. **Push whole files to Utopia** (text dual-write), so its `repo`, `adrs` and `code` readers can return file text, including the code blocks, tables and examples a statement does not carry.
4. **Run this again** after each of those, and nightly once both arms read text.

## How it was run

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

- **One question per document.** The sample is drawn per day, so a run on another day asks about different documents. Single-repository numbers move by a few documents between runs, as the CI run beside this one showed.
- **Small repositories.** Six repositories have four or fewer sampled documents; their rates are not meaningful on their own.
- **Utopia reads two sections only.** The comparison is of Lore's full assembly against Utopia's specs-and-ADRs assembly. It measures how far Utopia is from replacing Lore today, not how good each store is at the same job.
- **The documents are what the mirror holds.** The evals sample ADRs and specs, which is the one kind of data Utopia already carries. Questions about code or memories would favour Lore further.
