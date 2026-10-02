# Feature Specification: Context evals

| Field   | Value                                                                 |
| ------- | --------------------------------------------------------------------- |
| Feature | Context evals                                                         |
| Status  | In Progress                                                           |
| Created | 2026-10-02                                                            |
| Owner   | Platform Engineering                                                  |
| Module  | `apps/lore-api/src/work/context-evals/`, `apps/lore-api/src/transport/routes/context-evals/` |

A context eval asks one thing of Lore: when a developer asks about something a document decides, does Lore hand that document back, and can the question be answered from what it handed back. The questions are written from the documents themselves, so nobody writes or maintains a suite.

## Background

Lore's job is to give an agent the right documents for its question, and nothing measured whether it did. From 2026-08-13 to 2026-09-09 every embedding call was refused and every assembled context opened with the same three chunks, whatever the question; it was found by accident four weeks in (#1922 to #1937). The two nightly jobs meant to catch this, `eval_runner` and `context_core_builder`, never ran a suite and were deleted with Lore's own Floor on 2026-10-02, and the `evals` CI check skipped on every pull request for want of a model key, over suites that asked about a fictional company.

A hand trial on 2026-10-02 (five ADR questions against production) found the right ADR every time, and found a third to a half of each 8,000-token context spent on unrelated documents (#2459). A check that only asks whether the document came back would have read green. So an eval reports three things: found, answered, and the share of the returned tokens that was used.

The nightly job that samples documents and posts them here is a GitHub Actions workflow (#2443); its statements join this spec with it.

## One document's eval

- FR1.1 — `evaluateDocument` evaluates one document of one repository and reports its path, the question asked, `found`, `answered`, `useful_share`, the judge's one-sentence `reason` and the model that ran. ([validated by reports ADR-032 found, answered and a useful share of 0.6 when 600 of 1000 returned tokens come from the sources the answer used](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L60))
- FR1.2 — The question is written by the model from the document, and is the question Lore is asked for that document's repository. It stands on its own: it names the tool, route or rule it asks about and never the document, so it reads as a developer's question would. ([validated by asks Lore the question the model wrote, for the document's repository](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L74))
- FR1.3 — `found` is true when the document's own path is among the sources Lore returned. ([validated by reports found false when ADR-032 is not among the returned sources](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L82))
- FR1.4 — `answered` is the judge's verdict on an answer the model gave from the returned context only, graded against the document; a failed answer carries the judge's reason. The judge fails an answer that contradicts the document, that says the context did not hold the answer, or that does not address the question, and never one for holding correct detail the document does not mention: the answer is drawn from everything Lore returned. ([validated by reports answered false with the judge's reason when the judge fails the answer](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L99))
- FR1.5 — `useful_share` is the tokens of the returned sources the answer named as used, over all tokens returned, to two decimals. A source the answer names that Lore did not return counts for nothing. ([validated by counts only sources Lore returned towards the useful share, whatever else the answer names](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L111))
- FR1.6 — When Lore returns no context, the document is reported not found and not answered with the reason "Lore returned no context for the question", and no answer or verdict is asked of the model. ([validated by asks for no answer and no verdict when Lore returns no context](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L121))
- FR1.7 — A document Lore does not hold evaluates to nothing and costs no model call. ([validated by returns null and calls no model for a document Lore does not hold](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L133))
- FR1.8 — Every model call carries the job name `context-evals`, which is what files its cost under that name in `pipeline.llm_calls`. ([validated by tags all three model calls with the job name context-evals](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L140))
- FR1.9 — The model is shown at most 12,000 characters of a document. ([validated by shows the model at most 12000 characters of a longer document](apps/lore-api/src/work/context-evals/evaluate-document.test.ts#L152))

## The documents

- FR2.1 — A repository's eval documents are its ingested ADRs and `spec.md` files, read from the chunks an agent's context is assembled from, in the repository's own chunk schema. ([validated by reads the first chunk of every ADR and spec.md of re-cinq/lore from org_shared and returns the live ones](apps/lore-api/src/work/context-evals/eval-documents.test.ts#L59))
- FR2.2 — A document whose status says it is retired, rejected, superseded or deprecated is left out; a document that states no status is kept. ([validated by keeps a Shipped spec and an accepted ADR](apps/lore-api/src/work/context-evals/eval-documents.test.ts#L32), [validated by drops a Retired spec, a Rejected spec and a superseded ADR](apps/lore-api/src/work/context-evals/eval-documents.test.ts#L41), [validated by keeps a document that states no status](apps/lore-api/src/work/context-evals/eval-documents.test.ts#L51))
- FR2.3 — A document's text is its chunks joined in order, and a path with no ADR or spec chunks has no text. ([validated by joins the chunks of adrs/ADR-007.md in order](apps/lore-api/src/work/context-evals/eval-documents.test.ts#L78), [validated by returns null for a path with no ADR or spec chunks](apps/lore-api/src/work/context-evals/eval-documents.test.ts#L93))

## What Lore is asked

- FR3.1 — The context is assembled by the function `GET /api/context` uses, with the default template and budget, so an eval measures what an agent gets. The returned sources are every item of every section the budget kept, each with its path and tokens; an item with no path keeps its tokens under an empty path, and an assembly with no trace has no sources. ([validated by lists the path and tokens of every item in an included section](apps/lore-api/src/work/context-evals/assembled-for-eval.test.ts#L26), [validated by leaves out the items of a section the budget dropped](apps/lore-api/src/work/context-evals/assembled-for-eval.test.ts#L44), [validated by counts an item with no path under an empty path, so its tokens still weigh on the total](apps/lore-api/src/work/context-evals/assembled-for-eval.test.ts#L57), [validated by returns no sources when the assembly carried no trace](apps/lore-api/src/work/context-evals/assembled-for-eval.test.ts#L63))
- FR3.2 — An eval assembles passively: `assembleContext({ passive: true })` writes nothing, where an agent's assembly audits its memory searches. ([validated by writes nothing to the database when the default template is assembled passively](libs/server-core/src/work/context/context-assembly.test.ts#L308), [validated by audits its memory searches when the default template is assembled for an agent](libs/server-core/src/work/context/context-assembly.test.ts#L329))
- FR3.3 — A passive memory search (`searchMemories({ passive: true })`) returns what it found without strengthening it and without an audit row, so two hundred eval questions a night raise no memory's rank. A search that is not passive does both. ([validated by leaves no trace of a passive search: no retrieval UPDATE and no audit row for the episode e1 it returned](libs/shared/src/outbound/project/knowledge/memory-search.test.ts#L102), [validated by strengthens the episode e1 it returned and audits the search when it is not passive](libs/shared/src/outbound/project/knowledge/memory-search.test.ts#L126))

## The routes

- FR4.1 — `POST /api/context-evals` takes `{ repo, path }` and answers 200 with the document's eval. It needs the `write` scope, because every call spends on three model calls: a token that holds only `read` is refused 403. ([validated by answers 200 with the document's verdict: found, answered and a useful share of 0.75](apps/lore-api/src/transport/routes/context-evals/context-evals.test.ts#L54), [validated by answers 403 to a token that holds only the read scope, since every call spends on a model](apps/lore-api/src/transport/routes/context-evals/context-evals.test.ts#L86))
- FR4.2 — It answers 404 with `no ADR or spec at <path> in <repo>` for a document Lore does not hold, 400 for a repo that is not `owner/name` or a body with no path, and 503 with no database. ([validated by answers 404 naming the path for a document Lore does not hold](apps/lore-api/src/transport/routes/context-evals/context-evals.test.ts#L69), [validated by answers 400 for a repo that is not owner/name](apps/lore-api/src/transport/routes/context-evals/context-evals.test.ts#L78), [validated by answers 400 for a body with no path](apps/lore-api/src/transport/routes/context-evals/context-evals.test.ts#L82), [validated by answers 503 when there is no database](apps/lore-api/src/transport/routes/context-evals/context-evals.test.ts#L98))
- FR4.3 — `GET /api/context-evals/documents?repo=` (scope `read`) answers `{ documents }`, the paths of FR2.1 and FR2.2; 400 without a repo and 503 with no database. ([validated by lists the accepted ADR and leaves the Retired spec out](apps/lore-api/src/transport/routes/context-evals/context-eval-documents.test.ts#L38), [validated by answers 400 without a repo](apps/lore-api/src/transport/routes/context-evals/context-eval-documents.test.ts#L54), [validated by answers 503 when there is no database](apps/lore-api/src/transport/routes/context-evals/context-eval-documents.test.ts#L60))

## The model

Decision: the eval's model calls go through `Llm.for("eval")` (`specs/shared-utilities`, FR — Llm.for), so the vendor is configuration. The lore-api chart sets `LORE_EVAL_LLM_PROVIDER=vertex` and `LORE_EVAL_LLM_MODEL=gemini-2.5-flash`; Vertex is reached under the pod's own Google identity and no model key is stored. Writing a question and judging an answer against its document are easy tasks, so the cheapest model that judges reliably is the right one.

## Open Questions

- What a fair bar for `useful_share` is. It is reported and not gated until a few weeks of nightly numbers exist and #2459 is fixed.
