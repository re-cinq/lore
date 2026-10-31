# What to add to the knowledge stores for better answers

**For people deciding what Lore and Utopia should hold next.** This reads every question from the 2026-10-27 agent experiment ([context-store-agent-questions.md](context-store-agent-questions.md)) that a store did not answer fully, names why, and ranks what to add by the points it would win back.

## How we read the misses

Of 60 questions, the agent with Lore lost 25.5 points and the agent with Utopia lost 9.3 (Utopia at the night's search speed; scores are the mean of three asks). For every question below 1.00 we read the three answers, the judge's reasons and the tools the agent called, then checked the claim against the repository, and gave the miss one or more causes:

| Code | Cause |
|---|---|
| **T** | The answer is in an issue, a pull request or a commit, and the store's tools cannot search those. |
| **F** | The store returned only part of a requirement or a list, and the answer left the rest out. |
| **C** | The question names code (a function, a constant, a file), and the store has no map from a code name to its file. |
| **S** | The store returned a document without its status: a draft ADR read as a rule, a superseded decision, a paragraph without its later amendment, an issue that was only a proposal. |
| **X** | The repository's own documents contradict each other or the code, and the answer gave one side or missed that they conflict. |
| **D** | The answer is in a repository document the store does not hold (CLAUDE.md, docs/). |
| **G** | The data was there and the agent stopped or hedged. |

## Where the points went

| Cause | Points Lore lost | Points Utopia lost |
|---|---|---|
| T: issues, pull requests and commits not searchable | **11.3** | 0 |
| F: part of a requirement or list | 4.8 | **3.0** |
| C: no code name → file map | 3.2 | 1.1 |
| X: documents contradict each other or the code | 2.7 | 2.2 |
| S: a document's status not carried | 1.3 | **3.0** |
| D: repository document not held | 1.5 | 0 |
| G: agent stopped early | 0.7 | 0 |
| **Total** | **25.5** | **9.3** |

## What to add, in order

*Progress, 2026-10-31:* items 3 and 6 are done for Utopia (`Status:` and `Amended:` lines on every mirrored document, #4044; the `docs` source already held every markdown file), item 4 is half done (the `test-coverage` source's code definitions reach the Relevant Code and Coupled Spec & Tests sections of assembly, #4043, but a definition is found only when the query names its file or symbol), item 1 is open for Lore's own tools (`lore_search_context` reads the docs source with a repo, #4042; the tracker and history sources are searchable in Utopia and unread by Lore), item 2 is #4021 and item 5 is not started. Story: re-cinq/lore#4025.

1. **Issues, pull requests and commits, searchable by the agent.** This is 11 of Lore's 25.5 lost points and the whole of Utopia's lead on tracker (1.00 against 0.04) and history (0.96 against 0.54) questions. Utopia already holds them in its `github` and `git-history` sources. For Lore, reading them from the Utopia mirror is cheaper than building a second index.
2. **Whole requirements, not slices.** Both stores lost points to answers that named three of five conditions or most of a forbidden-word list. Utopia's answers said so themselves ("the FR-002 text was cut off in the search result") and rarely followed up with `get_document`. Return the whole numbered requirement, or the whole section, around each matching statement, and say in the search tool's description that a hit is a part of a longer document that `get_document` returns in full.
3. **A document's status beside its text.** Utopia's three wrong answers to lore-dec-03 and lore-temp-01 read ADR-044's retired cluster agent as current and draft ADR-039 as a rule once in force. Lore's lore-req-02 used FR12.19 without the FR12.19a amendment that changed it. Carry, on every returned chunk: an ADR's `status` (draft, accepted, superseded and by what), the date of the newest amendment of the section, a spec's `| Status |` row, and for an issue whether it is open, closed as done or closed unplanned. Rank a newer amendment above the text it amends.
4. **A code index: each exported name with its file.** Lore gave up on "where is `prFooter`" and "which function queues a ticket"; Utopia named `agent/src/lib/pr-body.ts` from an old design and Otto's pre-HAL `registry.ts` from an old issue. One entry per exported function, constant and type, with its path at the default branch's head and its one-line doc comment, answers a code-location question in one search and outranks a stale mention in a document. Lore's trace graph already lists code definitions; they reach neither store's search.
5. **Disagreements said out loud.** Every Otto temporal question asks about a behaviour whose spec and code disagree; both stores found the current behaviour and neither said the documents conflict. Where Lore already records a conflict (spec drift, `fact_conflicts`), return it with the statement it concerns.
6. **Every repository document, whole** (Lore). The answers to "what is stripped from memories", the skill Help-block rule and why the backfill uses `node:http` are in CLAUDE.md and docs/. Utopia's `docs` source holds every markdown file; Lore ingests specs and ADRs only.

## Fix the sources too

Some misses are the repositories being wrong, and no store fixes that:

- **lore ADR-010** still called the context evals nightly. Amended in the same change as this article.
- **Otto `specs/support-agent-conversation-data`**: FR-012 and FR-066 say `store.delete` clears only the cache, and the intro names a `PersistentSessionStore`. The code erases the stored conversation through HAL's `MongoSessionStore`.
- **Otto `docs/human-oversight.md`** describes only the call-time denial of an undeclared tool, not the refusal to start (`assertAllToolsDeclared`).
- **Otto escalation triggers**: #151 says "a sixth member", #178 "exactly six", RD-01 nine; the code has ten.

## Limits

- **One reader.** The causes were assigned by one person reading the answers, with no second rater. A miss with two causes splits its points between them.
- **Small numbers.** Some causes rest on two or three questions; the ranking of the first two is clear, the rest less so.
- **The bank decides the mix.** Eight of 60 questions ask about issues and pull requests; a bank with fewer would make cause T smaller.

## Raw data

One row per question that either store did not answer fully, with the mean score over three asks. Lore is the morning run; Utopia is the run at the night's search speed. A dash means that store answered fully.

| Id | Kind | Lore | Utopia (night) | Why Lore fell short | Why Utopia fell short |
|---|---|---|---|---|---|
| lore-dec-01 | decision | 0.83 | 1.00 | F | — |
| lore-dec-02 | decision | 1.00 | 0.83 | — | F |
| lore-dec-03 | decision | 1.00 | 0.33 | — | S |
| lore-req-01 | requirement | 0.50 | 0.50 | F | S |
| lore-req-02 | requirement | 0.17 | 1.00 | S | — |
| lore-req-03 | requirement | 0.33 | 1.00 | F | — |
| lore-req-04 | requirement | 0.00 | 1.00 | D | — |
| lore-req-05 | requirement | 0.83 | 1.00 | D | — |
| lore-code-01 | code-location | 0.50 | 1.00 | C | — |
| lore-code-02 | code-location | 0.00 | 0.83 | C | C,S |
| lore-code-03 | code-location | 0.33 | 1.00 | C | — |
| lore-code-04 | code-location | 0.50 | 0.50 | C | C |
| lore-hist-04 | history | 0.33 | 1.00 | T | — |
| lore-trk-01 | tracker | 0.00 | 1.00 | T | — |
| lore-trk-02 | tracker | 0.00 | 1.00 | T | — |
| lore-trk-03 | tracker | 0.00 | 1.00 | T | — |
| lore-trk-04 | tracker | 0.00 | 1.00 | T | — |
| lore-learn-03 | learned | 0.67 | 1.00 | D | — |
| lore-temp-01 | temporal | 0.50 | 0.00 | S | S |
| lore-temp-03 | temporal | 0.00 | 1.00 | X | — |
| lore-none-01 | unanswerable | 0.67 | 1.00 | G | — |
| otto-dec-01 | decision | 0.50 | 0.50 | F | F |
| otto-req-01 | requirement | 0.50 | 0.83 | F | F |
| otto-req-02 | requirement | 0.50 | 0.83 | F | F |
| otto-req-03 | requirement | 0.67 | 1.00 | F | — |
| otto-req-04 | requirement | 0.67 | 0.50 | F | F |
| otto-req-05 | requirement | 1.00 | 0.50 | — | F |
| otto-code-01 | code-location | 0.67 | 1.00 | C | — |
| otto-code-02 | code-location | 0.00 | 0.00 | F | F |
| otto-code-03 | code-location | 0.83 | 0.00 | C | C,S |
| otto-hist-01 | history | 0.50 | 1.00 | T | — |
| otto-hist-02 | history | 0.17 | 1.00 | T | — |
| otto-hist-03 | history | 0.00 | 1.00 | T | — |
| otto-hist-04 | history | 0.33 | 1.00 | T | — |
| otto-trk-01 | tracker | 0.00 | 1.00 | T | — |
| otto-trk-02 | tracker | 0.00 | 1.00 | T | — |
| otto-trk-03 | tracker | 0.33 | 1.00 | T | — |
| otto-trk-04 | tracker | 0.00 | 1.00 | T | — |
| otto-learn-01 | learned | 0.67 | 1.00 | F | — |
| otto-learn-02 | learned | 0.33 | 0.00 | X | X |
| otto-temp-01 | temporal | 0.83 | 0.50 | X | X,S |
| otto-temp-02 | temporal | 0.33 | 0.50 | X,G | X |
| otto-temp-03 | temporal | 0.50 | 0.50 | X | X |
