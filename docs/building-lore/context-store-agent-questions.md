# Lore or Utopia: what an agent can answer with each

**For people deciding where Lore's knowledge should live.** On 2026-10-27 we asked an agent 60 questions about two of our repositories, three times each, with no knowledge store, with Lore's, and with Utopia's, and measured how right the answers were, what they cost in tokens and how long they took. Utopia answered far more of them, for about a third of the tokens. The raw data is at the end.

## Why we measured

Lore is moving its knowledge into Utopia store by store, and a store switches only once Utopia answers at least as well ([context-store-comparison.md](context-store-comparison.md)). Until now the only measurement was the context evals: a model writes a question from one ADR or spec, and a lore-api model answers it from one assembled block of context. That tests one kind of question, the kind both stores hold, and no agent is involved.

The questions people really ask an agent are wider: why something was decided, which file does it, which pull request changed it, what changed since. And the agent decides itself which tools to call and when to stop. So this experiment asks those questions of a real agent, whose only source is the store's MCP server.

## Results

60 questions, 30 about re-cinq/lore and 30 about re-cinq/Otto, each asked 3 times per arm: 900 answers over five runs, none failed to run.

| Arm | Score (range across the 3 asks) | Hallucinated | Tokens p50 / p95 | Cost per question | Time p50 / p95 | MCP calls |
|---|---|---|---|---|---|---|
| no MCP | 0.07 (0.07–0.07) | 0% | 2,731 / 2,804 | $0.011 | 2.6 s / 8.1 s | 0 |
| Lore | 0.57 (0.55–0.60) | 10% | 49,421 / 187,507 | $0.080 | 16.3 s / 42.8 s | 3.4 |
| Utopia | **0.86** (0.84–0.88) | **7%** | 17,794 / 59,782 | $0.036 | 24.8 s / 70.9 s | 1.8 |
| Utopia, after that evening's search fix | 0.85 (0.82–0.87) | 9% | 17,813 / 58,693 | $0.034 | 14.4 s / 51.3 s | 1.7 |
| Utopia, at the night's search speed | 0.84 (0.82–0.87) | 8% | 17,800 / 60,602 | **$0.023** | **8.8 s / 30.6 s** | 1.7 |

Score: correct 1, partial 0.5, wrong or "I don't know" 0. On an unanswerable question, saying it does not know, or that no such thing exists, scores 1. "Hallucinated" is the share of answers judged wrong, plus answers to an unanswerable question. Cost is the API price Claude Code reports; the runs were billed to a subscription.

By repository, Utopia scored 0.91 on lore and 0.83 on Otto, against Lore's 0.52 and 0.62.

### By kind of question

| Kind | Questions | no MCP | Lore | Utopia |
|---|---|---|---|---|
| decision (why, from ADRs) | 10 | 0.00 | **0.93** | 0.90 |
| requirement (what a spec demands) | 10 | 0.00 | 0.52 | **0.87** |
| code location (which file or function) | 8 | 0.00 | 0.48 | **0.69** |
| history (when a commit changed something) | 8 | 0.00 | 0.54 | **0.96** |
| tracker (which issue or pull request) | 8 | 0.00 | 0.04 | **1.00** |
| learned (gotchas from memory and bug reports) | 6 | 0.08 | 0.78 | **0.89** |
| temporal (what changed since a decision) | 6 | 0.00 | 0.53 | **0.58** |
| unanswerable | 4 | 1.00 | 0.92 | **1.00** |

The Utopia column is the first Utopia run. Scores are after the re-grading described under Limits.

### Consistency

| Arm | Same verdict on all 3 asks | Median spread of tokens (CV) | Median spread of time (CV) |
|---|---|---|---|
| no MCP | 98% | 0% | 26% |
| Lore | 62% | 25% | 30% |
| Utopia | 85% | 0% | 26% |

A second grading of the first ask gave the same verdict for 97% of the answers.

### Head to head

| Comparison | Better / worse / level | Exact McNemar p | Median extra tokens | Median extra time |
|---|---|---|---|---|
| Lore vs no MCP | 44 / 1 / 15 | < 0.001 | +56,651 | +13.5 s |
| Utopia vs no MCP | 54 / 0 / 6 | < 0.001 | +17,188 | +23.7 s |
| Lore vs Utopia | 7 / 32 / 21 | < 0.001 | +28,988 | −8.4 s |

## What we read in it

- **Without a store the agent knows nothing about our repositories.** It scores 0.07, almost all of it from declining the unanswerable questions, and it does not make things up: it says it does not know.
- **Utopia answers more than Lore, for less.** It scored 0.86 against 0.57, and was better on 32 questions and worse on 7. It used about a third of Lore's tokens and half its cost, and it was more consistent.
- **The gap is what Utopia holds and Lore's tools cannot reach.** Tracker questions: Utopia 1.00, Lore 0.04. History: 0.96 against 0.54. Utopia's base carries the issues, pull requests and commits (its `github` and `git-history` sources), so one search returns the pull request itself: "Pull request #3705 in re-cinq/lore, 'Implementation loop: fix-ci on Gemini 4 Argon', moved the step… merged on 2026-10-26." Lore's agent found the decision, then said, correctly, that nothing it could search named the pull request.
- **Utopia also wins on specs.** Requirements 0.87 against 0.52: Utopia hands back whole documents, amendments included, where Lore's agent sometimes read an older paragraph without the amendment beside it.
- **Neither store is good at what changed since** (temporal: Utopia 0.58, Lore 0.53). Both find the current behaviour but rarely say that the documents disagree, and Utopia read draft ADR-039 as a rule that was once in force.
- **Lore keeps a small edge on decisions,** 0.93 against 0.90. That is one question's worth, inside the noise.
- **Both stores repeat stale documents.** Most wrong answers came from a text overtaken by an amendment or a later pull request. One of them was our own ADR-010, which still called the context evals nightly after #2823 removed the schedule. It is amended in the same change as this article.
- **Lore's answers vary most.** Only 62% of questions got the same verdict all three times with Lore. Its score moved between 0.53 and 0.61 on the asks alone, so differences of under about 0.08 are noise. Most of the spread is the agent picking different tools on different asks.

## Utopia's search speed

The first Utopia run waited a long time on every search. One search took 83–118 s on lore's base and 12–37 s on Otto's. The Utopia database had no approximate-nearest-neighbour index (no HNSW or IVFFlat), so every vector search compared the question with every stored vector. Its 3072-dimension embeddings are also above pgvector's 2,000-dimension HNSW limit. Claude Code's default MCP tool timeout is shorter than those searches, so that run used `MCP_TOOL_TIMEOUT` at 5 minutes.

Utopia was changed the same evening and the arm was asked again with the default timeout. Answers took 14.4 s at the median instead of 24.8 s, about Lore's 16.3 s, with the same quality. Only 2 of its 11 failed tool calls were timeouts. The other 9 were the agent calling tools that do not exist. Later that night one search took 0.6–6 s on either base, and a third run answered in 8.8 s at the median, about half Lore's time, at $0.023 a question, with the same quality (0.84).

## What this suggests

1. **Make Utopia the store agents read**, by kind first where the gap is widest: issues and pull requests, history, requirements, and what changed since a decision.
2. **Keep Utopia's search fast.** At the day's first speed, an agent with default settings got timeouts, not answers.
3. **Rank newer statements above older ones in both stores.** Every stale-document error was an older text winning over its amendment.
4. **Add what the misses ask for:** issues, pull requests and commits for Lore, whole requirements, documents' status and a code index for both. The miss-by-miss reading is in [context-store-what-to-add.md](context-store-what-to-add.md).
5. **Run it again** before the two-week mark the switch rule asks for, from a developer machine with the same harness.

## How it was run

- **Harness**: [re-cinq/loop-bench](https://github.com/re-cinq/loop-bench) `src/qa/` (re-cinq/loop-bench#1), run from a laptop: `npm run qa -- run --bank experiments/context-qa/banks/lore.yaml,experiments/context-qa/banks/otto.yaml --arms <arm> --reps 3`. No MCP and Lore ran 3 asks at a time in the morning, and Utopia ran 2 at a time in the afternoon and again in the evening.
- **Agent**: `claude --print` with `claude-sonnet-5-5` at medium effort. Each ask is a fresh process, set up like this:
  - a new scratch HOME holding only the credentials and an empty settings file, with no CLAUDE.md, memory, hooks or user skills (checked in each run's start-up line);
  - an empty git repository whose `origin` names the subject, so it has no file to read;
  - `--tools ""` removes every built-in tool, and `--strict-mcp-config` gives it only the arm's MCP server.
- **Prompt**, the same for every arm: the repository's name, that the agent cannot read the repository's files and has only its own knowledge and the tools listed to it, to say "I don't know" rather than guess, and to reply as JSON with its sources.
- **Lore**: the Lore MCP adapter as installed on the laptop, against the production lore-api. Every write tool is blocked, and `CONTEXT_PATH` points at the empty run dir so the adapter reads no local files.
- **Utopia**: Utopia's MCP route for the repository's base (`/api/v1/kbs/<kb>/mcp`) through `kubectl port-forward`, because Utopia sits behind a Google login. It used a read-only personal access token, so Utopia hid its one write tool.
- **Judge**: a second fresh `claude --print` with `claude-opus-5-5` and no tools. It gets the question, the hand-checked gold answer and the answer, and returns correct, partial, wrong or abstained. The first ask was graded twice to measure the judge.
- **Questions**: 30 per repository, by kind: 5 decision, 5 requirement, 4 code location, 4 history, 4 tracker, 3 learned, 3 temporal and 2 unanswerable. One question was replaced after a smoke test: the Lore MCP server's own instructions answered it.
- **Every answer in full**, with its verdict: loop-bench `results/context-qa/2026-10-27/ANSWERS.md`. Each ask's transcripts are kept beside it.

## Limits

- **One day, one answering model.** Sonnet 5.5 at medium effort. The switch rule asks for two weeks of results.
- **Small cells.** Each kind has 4 to 10 questions, so a kind's score moves by about 0.1 when one question flips.
- **The arms ran hours apart.** Utopia's base held a few more hours of mirrored issues and commits than Lore's did at its run. No question asks about anything from that day after the bank was checked.
- **Different tool timeouts.** The first Utopia run used a 5-minute timeout. No call by the other arms came near the default.
- **Both stores hold traces of this very work.** Lore's memory holds episodes from the sessions that did it, and Utopia mirrors the issues and pull requests. That is what each store really knows, so it counts.
- **Lore's adapter was the laptop's 2026-10-08 build**, not current main. It only forwards to lore-api, which ran current main.
- **The asks strengthened what they read.** Lore's searches raised retrieval counts on the facts they returned, under the agent id `context-qa-bench`.
- **Grading fixes after the runs, none of which re-asked a question.** An unanswerable question answered "no such thing exists" had been counted as a hallucination, and was re-scored. Eight gold answers had been cut short by the bank's YAML (an unquoted ` #` starts a comment), and five were wrong in a way the stores' answers exposed: ADR-039 is a draft, PR #2491 merged on 2026-10-02 UTC, PR #2787's merge commit is `5b157bdfc`, the fact threshold is also defined in `libs/server-core`, and `customer_scope_conflict` is Otto's own failure kind. All twelve questions were judged again in every run.

## Raw data

### The questions and gold answers

Each gold answer was checked by hand against lore `195034dad`, Otto `3facba0` and GitHub on 2026-10-27, and five were corrected after the runs (see Limits).

| Id | Kind | Question | Gold answer | Evidence |
|---|---|---|---|---|
| lore-dec-01 | decision | How does a re-cinq npm package get published, and why does the release job compare the git tag with package.json first? | A GitHub Actions workflow on a v* tag runs npm publish --provenance through npm Trusted Publishing over OIDC, with no NPM_TOKEN secret (only the very first publish of a new name uses a short-lived token). The job fails before publishing when the tag and the committed package.json version disagree, because v0.5.0 through v0.7.0 once published nothing for nine weeks while npm's duplicate-version rejection read like an auth failure. | adrs/ADR-045-npm-package-publishing.md |
| lore-dec-02 | decision | How does Lore's web UI receive live run updates and plan collaboration traffic? | Over one WebSocket per browser tab at lore-api's /api/ws, multiplexed into channels (run, runs, plan) with a JSON envelope. It replaced one SSE connection per run. | adrs/ADR-048-one-websocket-for-live-channels.md |
| lore-dec-03 | decision | Where do Lore's agent pods run, and does Lore hold a Kubernetes client to start them? | They run in pods of the external floor (re-cinq/floor), which Lore reaches only through @re-cinq/floor-client (FLOOR_API_URL). Lore holds no Kubernetes client. | adrs/ADR-049-external-floor.md |
| lore-dec-04 | decision | How are Lore's service metrics collected and viewed? | Each service exposes Prometheus text on a metrics port (:9464) through OpenTelemetry. kube-prometheus-stack (terraform enable_monitoring) scrapes it and Grafana shows it. Traces go to Cloud Trace, from lore-api only. | adrs/ADR-050-prometheus-grafana-metrics.md |
| lore-dec-05 | decision | If pushing a spec to Utopia fails during a Lore ingest, does the ingest fail? | No. Utopia is a mirror. A failed push is logged and counted (lore_utopia_mirror_failures_total) and never fails the ingest. | adrs/ADR-052-code-to-spec-graph-mirrored-in-utopia.md |
| lore-req-01 | requirement | What makes Lore's auto-merge loop keep waiting instead of approving a pull request? | Any of these holds the wait. Red CI, a merge conflict, an open review thread, a review not yet approved on the head commit, or the pull request being younger than auto_merge.min_age_hours (24 by default). | specs/protected-branch-merge/spec.md, apps/stations/src/work/pr-ready-check/decide-merge-ready.ts |
| lore-req-02 | requirement | In Lore, after a push to main, how many implementation-loop upkeep runs can start per repository, and which pull requests go first? | At most 3 per event per repository. The pull request upkept longest ago goes first. That is one never upkept, then the one whose newest upkeep run started earliest, then the oldest. | specs/external-floor/spec.md |
| lore-req-03 | requirement | Which Lore loops run on a repository whose settings say nothing about them? | Triage, spec upkeep and spec tickets are on by omission. The implementation loop, code review (auto_review), auto-merge and digest are off by omission. | libs/shared/src/domain/loops/loop-enabled.ts |
| lore-req-04 | requirement | What does Lore strip from memories and episodes before storing them? | API keys, JWTs, private keys, connection strings and bearer tokens, removed by sanitizeContent()/redactSecrets(). | libs/shared/src/lib/redact.ts, CLAUDE.md |
| lore-req-05 | requirement | What must a Lore skill's SKILL.md contain for the pull request check to pass? | A Help block fenced by <!-- lore-help:begin --> and <!-- lore-help:end --> holding a **Summary.** and a **Usage:**. The skill-help check (scripts/check-skill-help.sh) fails a skill without one. | specs/lore-help/spec.md |
| lore-code-01 | code-location | In Lore, which file decides whether a pull request is ready for the auto-merge loop to approve? | apps/stations/src/work/pr-ready-check/decide-merge-ready.ts, with its reads in merge-readers.ts beside it. | apps/stations/src/work/pr-ready-check/decide-merge-ready.ts |
| lore-code-02 | code-location | Where is the Lore-Task footer of Lore-authored pull request bodies composed? | prFooter() in libs/shared/src/domain/pr-body.ts. | libs/shared/src/domain/pr-body.ts |
| lore-code-03 | code-location | Which Lore function puts a GitHub issue into a repository's implementation backlog? | queueTicket in libs/shared/src/work/backlog/queue-ticket.ts. It applies to an issue with a priority:* label, which a lore or lore:implementation label also gives. | libs/shared/src/work/backlog/queue-ticket.ts |
| lore-code-04 | code-location | Where is the similarity threshold that marks two Lore memory facts as contradicting defined, and what is its value? | 0.92, defined twice: FACT_SIMILARITY_THRESHOLD = 0.92 in libs/shared/src/outbound/dgraph-fact-contradictions.ts, and in libs/server-core/src/work/memory/fact-contradictions.ts read from the LORE_FACT_SIMILARITY_THRESHOLD env var with 0.92 as its default. Either location is right. | libs/shared/src/outbound/dgraph-fact-contradictions.ts |
| lore-hist-01 | history | When was Lore's own Floor engine (apps/floor) deleted, and what replaced it? | On 2026-10-02 in commit ca031776d (#2431). The external floor (re-cinq/floor, ADR-049) replaced it. | ca031776d, #2431 |
| lore-hist-02 | history | When was Lore's nightly context reindex job retired? | On 2026-09-08 in commit 961755bac (#1880). | 961755bac, #1880 |
| lore-hist-03 | history | When was Lore's event-router deleted, and what now receives GitHub webhooks? | It was deleted when PR #2491 merged on 2026-10-02 at 22:13 UTC (commit 6682f8999, dated 2026-10-03 00:13 in CEST; either date is right). lore-api's POST /api/webhook/github receives the webhooks and writes pipeline.events. | 6682f8999, #2491 |
| lore-hist-04 | history | When did Lore's context reads become able to choose between Lore's own stores and Utopia? | On 2026-10-16, by PR #2787 ("Context reads choose a backend: lore, utopia or both"; merge commit 5b157bdfc, also on main as fb53a29c0; either commit is right), which added backend lore \| utopia \| both. | fb53a29c0, #2787 |
| lore-trk-01 | tracker | Which Lore pull request moved the implementation loop's fix-ci step to Gemini 4 Argon? | #3705, merged 2026-10-26. | #3705 |
| lore-trk-02 | tracker | Which Lore issue tracks retiring Dgraph by mirroring the code-to-spec graph into Utopia? | #2766, "Retire Dgraph: mirror the code-to-spec graph in Utopia, slice 1". | #2766 |
| lore-trk-03 | tracker | Which Lore pull request added the spec tickets loop to the Loops tab? | #3392, merged 2026-10-24. | #3392 |
| lore-trk-04 | tracker | Which Lore pull request stopped the context evals from running on a schedule? | #2823, merged 2026-10-19 ("run from a developer machine, never on a schedule"). | #2823 |
| lore-learn-01 | learned | In Lore, why can an OpenTelemetry instrument created at module import never record anything? | The OTel metrics API has no proxy meter. An instrument created before the SDK registers its meter provider stays a no-op for good, so Lore resolves its instruments lazily against the current provider. | libs/shared/src/outbound/otel/, CLAUDE.md |
| lore-learn-02 | learned | Why did Lore's Gemini agent pods before 2026-09-23 run with no MCP tools? | ai-agent-subsystem v0.11.2 wrote the MCP servers into a system-scope settings file, which gemini-cli refuses for a uid-1000 directory. v0.11.3 writes them to the user settings (/agent/.gemini/settings.json). | CLAUDE.md |
| lore-learn-03 | learned | Why does Lore's weekly Utopia backfill sweep call lore-api over node:http rather than fetch? | fetch gives up after 5 minutes without response headers, and a backfill takes longer. The sweep uses node:http with a 30-minute wait. | CLAUDE.md |
| lore-temp-01 | temporal | Must Lore's code review run on a different model family from the implementer? | No. ADR-039 proposed cross-family review but is still a draft, so it was never a rule. Its 2026-10-14 amendment put code-review and code-review-recheck on gemini-4-argon, the implementation loop's own family, because it caught more, so cross-family is only one input to the model choice. | adrs/ADR-039-cross-model-review.md |
| lore-temp-02 | temporal | Does Lore's auto-merge loop fix a pull request whose CI is red? | No. It did when it shipped (#3320, 2026-10-23), but #3376 the same day removed the fix agent ("auto merge fixes nothing"). A loop pull request is repaired by the implementation loop's upkeep run, and a person's pull request by the person. | #3320, #3376, specs/protected-branch-merge/spec.md |
| lore-temp-03 | temporal | Do Lore's context evals run nightly in CI? | No. They ran nightly from 2026-10-02 (#2463) until #2823 (2026-10-19) removed the schedule. They now run from a developer machine. | #2463, #2823 |
| lore-none-01 | unanswerable | What p99 latency SLO is defined for Lore's /api/context route? | None. No SLO or p99 latency target is defined anywhere for /api/context. |  |
| lore-none-02 | unanswerable | Who is the PagerDuty on-call owner for lore-api? | Unknown. No on-call owner is recorded in the repository, its docs or its tracker. |  |
| otto-dec-01 | decision | Why does Otto use one server-side TMS API key instead of passing each user's own TMS credentials through? | Otto uses one global TMS_API_KEY and enforces the customer boundary in its own code. Forwarding a user's credential is impossible because the TMS has no user-level auth, and per-user credentials are moot because the TMS issues one key per integration partner. | adrs/ADR-001-tms-authentication.md |
| otto-dec-02 | decision | Why does Otto always show delivery status as a card and never let the model phrase it in prose? | The card-rate KPI (SC-006, at least 90% by 2026-Q4) needs card turns as its denominator. The compliance promise is TMS status shown verbatim, so a paraphrased ETA is the one hallucination the pilot cannot afford. Free text was proposed on PR #261 and rejected on 2026-09-25. | adrs/ADR-002-deterministic-delivery-status-rendering.md |
| otto-dec-03 | decision | Why doesn't Otto run on Cloud Run in europe-north1 as first planned? | On 2026-10-16 europe-north1 served only Gemini 2.5, which retired on 2026-10-20, and newer Gemini models answer only on the eu multi-region. Otto runs on GKE Autopilot (n8n-cluster) in europe-west1, and #27, #162 and #168 were closed as superseded. | adrs/ADR-003-hosting-and-data-residency.md |
| otto-dec-04 | decision | Why doesn't Otto use Vertex AI's global endpoint, which serves every Gemini model? | It would give up the EU data residency the model allowlist enforces. The model is pinned to the eu multi-region (region 'eu' in apps/api/src/configuration/models.ts, vertexLocation eu in the deploy values). | adrs/ADR-003-hosting-and-data-residency.md |
| otto-dec-05 | decision | Why is Otto's escalation-trigger exhaustiveness check a Record rather than a switch with no default? | A Record over EscalationTrigger fails typecheck on a missing member just as a switch would, and a switch over every member exceeds the lint complexity limit. | specs/support-agent-escalation/spec.md |
| otto-req-01 | requirement | How must Otto pick a persona for an incoming message? | selectPersona(registry, message) is pure and uses deterministic keyword matching, not a classifier call. A case-insensitive substring of a persona's match entries selects it, the first declared persona wins a tie, and olt-support is the default when nothing matches. | specs/support-agent-persona/spec.md |
| otto-req-02 | requirement | What may Otto's Danish "tool budget ran out" message not contain? | TOOL_BUDGET_MESSAGE_DA contains no < and no digit, so no phone number, email or opening hours. It also contains none of the words ring, minutter or timer, and no persona name. | specs/support-agent-escalation/spec.md |
| otto-req-03 | requirement | What inputs may Otto's escalate_to_human tool take? | Exactly one, the required enum reason_category, with the values no_tool_for_question, customer_asked_for_human or out_of_scope_change_request. | specs/support-agent-escalation/spec.md |
| otto-req-04 | requirement | How must Otto's conversation retention period be configured? | CONVERSATION_RETENTION_DAYS has no default. Anything but a whole number from 1 to 999999 stops the api before the port opens, naming the variable and the value, with no clamping. The Helm chart fails to render without api.conversationRetentionDays. | specs/support-agent-conversation-data/spec.md, apps/api/src/configuration/config.ts |
| otto-req-05 | requirement | Can one of Otto's tools take a customer number in its input schema? | No. No tool may declare a customer id, company id or account number at any depth, in English or Danish spellings. registerTools refuses such a definition, and a test walks every registered definition. | specs/support-agent-tms-access/spec.md, adrs/ADR-001-tms-authentication.md |
| otto-code-01 | code-location | Where does Otto's api refuse to start when a registered tool has no declared authority? | assertAllToolsDeclared in apps/api/src/oversight/assertAllToolsDeclared.ts, called from apps/api/src/server.ts. It checks the TOOL_AUTHORITY table in apps/api/src/oversight/toolAuthority.ts. | apps/api/src/oversight/assertAllToolsDeclared.ts, apps/api/src/server.ts |
| otto-code-02 | code-location | Where does Otto map TMS error kinds to escalation triggers, and which kinds escalate? | ESCALATION_BY_KIND in apps/api/src/tools/defineTmsTool.ts, keyed by TmsFailureKind (the TMS client's error kinds plus Otto's own customer_scope_conflict). Three kinds escalate: unavailable (tms_unavailable), timeout (tms_timeout) and customer_scope_conflict (customer_scope_conflict); every other kind maps to null. Saying customer_scope_conflict is not one of the TMS client's own error kinds is right. | apps/api/src/tools/defineTmsTool.ts |
| otto-code-03 | code-location | Which Otto function catches a tool executor that throws? | createCrashGuard in apps/api/src/tools/toolCrashGuard.ts. The spec calls it withCrashGuard, and either name with that file is right. | apps/api/src/tools/toolCrashGuard.ts |
| otto-code-04 | code-location | Where is the JWT claim that carries the customer number defined in Otto? | CUSTOMER_NUMBER_CLAIM = 'customer_number' in apps/api/src/oauth/customerIdentity.ts. | apps/api/src/oauth/customerIdentity.ts |
| otto-hist-01 | history | When did Otto's human-oversight gate stop wrapping each tool executor? | On 2026-09-29 in commit 70d7f24. The gate moved to HAL Engine 0.3.0's beforeToolCall hook, and withHumanOversight and oversightGate.ts were deleted. | 70d7f24 |
| otto-hist-02 | history | When did Otto's off TMS mode go away? | On 2026-10-16 in commit e773dd8. TMS_MODE became stand-in or live, and get_booking_status registers in every deployment. | e773dd8 |
| otto-hist-03 | history | When did Otto's conversations start surviving an api restart? | On 2026-09-30 in commit 3f731c4, which composed the engine with HAL Engine 0.4.0's MongoSessionStore instead of the in-memory default store. | 3f731c4 |
| otto-hist-04 | history | When was Otto's own WebSocket frame recorder dropped, and what replaced it? | On 2026-10-21 in commit 8834b9b (PR #431). HAL Engine 0.10.0's recordedFrames export replaced it. | 8834b9b, #431 |
| otto-trk-01 | tracker | Which Otto pull request recorded the TMS authentication decision? | #412, merged 2026-10-21. | #412 |
| otto-trk-02 | tracker | Is there an open Otto bug about the tool-budget message promising a follow-up that nobody makes? | Yes, #498 (open, labelled lore:blocked). The message "En kollega vil følge op…" notifies nobody while no escalation destination is configured. It is blocked on KU-14 and on a Danish speaker (KU-15). | #498 |
| otto-trk-03 | tracker | Which Otto pull request routed the GCP Data Access audit logs to their own bucket, and in which region is the bucket? | #504, merged 2026-10-25. The bucket is in europe-north1. | #504, cce7e9b |
| otto-trk-04 | tracker | Which Otto pull request made FALLBACK_MODEL_ID actually reach HAL Engine's failover? | #475, merged 2026-10-23, which closes issue #474. | #475, #474 |
| otto-learn-01 | learned | Can Otto's chat client clear its busy flag on an error frame? | No. An INVALID_MESSAGE error can arrive between two entry_delta frames of a healthy stream. stream_end is the only terminal signal, sent once per accepted message, so busy clears only on stream_end or on socket close. | #191, #148 |
| otto-learn-02 | learned | In Otto, is setting a fallback model and passing resilience to HAL Engine enough for model failover? | No. resilience is only a retry policy. HAL Engine fails over only through fallbackProviders, which buildEngine never passed. A FALLBACK_MODEL_ID of mock behind a Vertex primary would echo the customer's message back, so it is refused. | #474, #482, #475 |
| otto-learn-03 | learned | Is it safe from logging for Otto to send the access token as the WebSocket subprotocol? | Not on its own. The server echoed the first offered subprotocol into the 101 response headers, where ingress or proxy logs can capture it. The client now offers the marker hal.v1 first and then the token, and the server selects the marker. | #150, #192 |
| otto-temp-01 | temporal | In Otto, does store.delete(sessionId) erase the stored conversation or only the cache? | Today it erases both. HAL Engine 0.11.0's MongoSessionStore.delete calls eraseConversation, and eraseUserData erases through it. The spec conflicts with this. FR-012/FR-066 still say delete clears only the in-memory Map, and the spec intro still names a custom PersistentSessionStore and a conversations collection. Since 3f731c4 the code uses HAL's MongoSessionStore and the hal_sessions collection. | specs/support-agent-conversation-data/spec.md, apps/api/src/conversations/conversationStore.ts, apps/api/src/erasure/eraseUserData.ts |
| otto-temp-02 | temporal | How many escalation triggers does Otto have? | Ten in code. These are the 5 original triggers plus tool_budget_exhausted, model_call_failed, blocked_consequential_call, tool_crashed and customer_scope_conflict. The documents conflict. #151 calls its trigger "a sixth member", #178 says "exactly six" and RD-01 says nine, and needs_manual_tms_check is still undecided. | apps/api/src/escalation/triggers.ts, specs/support-agent-escalation/spec.md |
| otto-temp-03 | temporal | What happens in Otto to a tool that has no row in the authority table? | The api refuses to start and names the tool (assertAllToolsDeclared). At call time the beforeToolCall gate also denies any unknown name by default as requires_human_action. The docs conflict. docs/human-oversight.md still describes only the deny-at-call behaviour, which dates from the per-executor wrapper (d217b6d) that 70d7f24 replaced. | docs/human-oversight.md, specs/support-agent-human-oversight/spec.md, apps/api/src/oversight/toolAuthority.ts |
| otto-none-01 | unanswerable | What p95 response-latency target do Otto's get_booking_status answers have in production? | None. No latency target exists in the repository or the tracker. |  |
| otto-none-02 | unanswerable | How many OLT support staff per shift handle Otto's escalations? | Unknown. Even the escalation recipient is still open (KU-14, UU-09, UU-10), and no staffing figure exists. |  |

### Every ask

One row per question and run; the three asks are separated by `/`. Verdict: **C** correct, **P** partial, **W** wrong, **A** abstained ("I don't know"). An unanswerable question scores 1 on A or C. Tokens are input + output + cache reads and writes; time is the whole run, in seconds; calls are MCP tool calls. "utopia" is the first Utopia run (5-minute MCP timeout), "utopia (evening)" the run after that evening's search fix, "utopia (night)" the run at the night's search speed (both with the default timeout).

| Id | Run | Verdicts | Score | Tokens | Time (s) | Calls | Cost ($) |
|---|---|---|---|---|---|---|---|
| lore-dec-01 | none | A/A/A | 0.00 | 2,787/2,797/2,789 | 2/2/2 | 0/0/0 | 0.002/0.012/0.012 |
| lore-dec-01 | lore | C/C/P | 0.83 | 40,509/28,414/55,894 | 13/12/18 | 2/1/3 | 0.076/0.036/0.080 |
| lore-dec-01 | utopia | C/C/C | 1.00 | 31,629/31,565/31,662 | 35/113/82 | 2/2/2 | 0.064/0.044/0.045 |
| lore-dec-01 | utopia (evening) | C/C/C | 1.00 | 31,887/31,656/31,720 | 31/35/15 | 2/2/2 | 0.067/0.045/0.046 |
| lore-dec-01 | utopia (night) | C/C/C | 1.00 | 31,693/31,723/31,876 | 16/23/14 | 2/2/2 | 0.045/0.037/0.014 |
| lore-dec-02 | none | A/A/A | 0.00 | 2,745/2,746/2,743 | 2/4/13 | 0/0/0 | 0.012/0.012/0.012 |
| lore-dec-02 | lore | C/C/C | 1.00 | 30,708/33,207/30,622 | 15/21/17 | 1/1/1 | 0.046/0.056/0.045 |
| lore-dec-02 | utopia | C/C/P | 0.83 | 17,721/17,704/17,791 | 30/97/64 | 1/1/1 | 0.046/0.027/0.027 |
| lore-dec-02 | utopia (evening) | C/C/C | 1.00 | 17,669/17,719/17,688 | 17/20/6 | 1/1/1 | 0.046/0.027/0.026 |
| lore-dec-02 | utopia (night) | C/P/C | 0.83 | 17,726/17,669/17,668 | 10/7/6 | 1/1/1 | 0.027/0.007/0.007 |
| lore-dec-03 | none | A/A/A | 0.00 | 2,733/2,733/2,739 | 3/3/2 | 0/0/0 | 0.011/0.011/0.012 |
| lore-dec-03 | lore | C/C/C | 1.00 | 32,121/32,131/32,065 | 12/10/9 | 1/1/1 | 0.048/0.049/0.048 |
| lore-dec-03 | utopia | C/W/P | 0.50 | 29,974/17,484/29,901 | 20/36/69 | 2/1/2 | 0.038/0.025/0.039 |
| lore-dec-03 | utopia (evening) | W/P/W | 0.17 | 30,003/63,342/17,467 | 33/64/6 | 2/4/1 | 0.038/0.066/0.025 |
| lore-dec-03 | utopia (night) | W/P/P | 0.33 | 30,172/45,219/17,532 | 12/13/7 | 2/3/1 | 0.040/0.022/0.017 |
| lore-dec-04 | none | A/A/A | 0.00 | 2,703/2,705/2,763 | 2/4/3 | 0/0/0 | 0.011/0.011/0.012 |
| lore-dec-04 | lore | C/C/C | 1.00 | 30,444/31,003/29,172 | 13/16/11 | 1/1/1 | 0.046/0.047/0.040 |
| lore-dec-04 | utopia | C/C/C | 1.00 | 17,942/31,848/17,938 | 14/33/37 | 1/2/1 | 0.028/0.047/0.028 |
| lore-dec-04 | utopia (evening) | C/C/C | 1.00 | 17,957/17,924/42,477 | 24/19/14 | 1/1/2 | 0.029/0.028/0.049 |
| lore-dec-04 | utopia (night) | C/C/C | 1.00 | 17,919/17,880/32,356 | 27/16/15 | 1/1/2 | 0.028/0.019/0.029 |
| lore-dec-05 | none | A/A/A | 0.00 | 2,734/2,743/2,749 | 5/2/4 | 0/0/0 | 0.011/0.012/0.012 |
| lore-dec-05 | lore | C/C/C | 1.00 | 48,408/82,854/50,021 | 13/17/10 | 3/4/3 | 0.051/0.088/0.057 |
| lore-dec-05 | utopia | C/C/C | 1.00 | 17,259/16,595/17,221 | 13/25/32 | 1/1/1 | 0.023/0.020/0.023 |
| lore-dec-05 | utopia (evening) | C/C/C | 1.00 | 28,812/16,605/28,665 | 30/20/10 | 2/1/2 | 0.034/0.020/0.033 |
| lore-dec-05 | utopia (night) | C/C/C | 1.00 | 16,851/16,895/43,031 | 9/14/12 | 1/1/3 | 0.022/0.013/0.028 |
| lore-req-01 | none | A/A/A | 0.00 | 2,722/2,730/2,728 | 2/5/4 | 0/0/0 | 0.011/0.011/0.011 |
| lore-req-01 | lore | P/P/P | 0.50 | 56,812/65,072/162,836 | 17/27/39 | 3/4/7 | 0.048/0.065/0.143 |
| lore-req-01 | utopia | C/C/C | 1.00 | 53,046/37,996/38,032 | 33/32/41 | 3/2/2 | 0.083/0.071/0.071 |
| lore-req-01 | utopia (evening) | C/C/C | 1.00 | 17,511/30,541/17,558 | 16/36/13 | 1/2/1 | 0.025/0.042/0.026 |
| lore-req-01 | utopia (night) | P/W/C | 0.50 | 28,683/28,729/30,233 | 22/13/11 | 2/2/2 | 0.033/0.025/0.030 |
| lore-req-02 | none | A/A/A | 0.00 | 2,752/2,750/2,748 | 2/2/3 | 0/0/0 | 0.012/0.012/0.012 |
| lore-req-02 | lore | W/P/W | 0.17 | 28,266/51,669/81,274 | 7/12/23 | 2/3/4 | 0.032/0.062/0.093 |
| lore-req-02 | utopia | C/C/C | 1.00 | 17,411/17,370/17,482 | 21/30/35 | 1/1/1 | 0.024/0.024/0.025 |
| lore-req-02 | utopia (evening) | C/C/C | 1.00 | 17,509/17,439/17,398 | 19/19/8 | 1/1/1 | 0.025/0.024/0.024 |
| lore-req-02 | utopia (night) | C/C/C | 1.00 | 17,530/17,381/17,506 | 5/15/16 | 1/1/1 | 0.025/0.005/0.006 |
| lore-req-03 | none | A/A/A | 0.00 | 2,715/2,714/2,719 | 2/2/2 | 0/0/0 | 0.011/0.011/0.011 |
| lore-req-03 | lore | P/P/W | 0.33 | 73,612/141,711/25,853 | 23/47/10 | 5/8/1 | 0.080/0.112/0.024 |
| lore-req-03 | utopia | C/C/C | 1.00 | 17,531/17,532/17,516 | 19/30/34 | 1/1/1 | 0.025/0.025/0.025 |
| lore-req-03 | utopia (evening) | C/C/C | 1.00 | 17,482/17,474/27,541 | 19/16/8 | 1/1/2 | 0.024/0.024/0.026 |
| lore-req-03 | utopia (night) | C/C/C | 1.00 | 17,493/17,507/17,474 | 13/7/5 | 1/1/1 | 0.025/0.005/0.005 |
| lore-req-04 | none | A/A/A | 0.00 | 2,695/2,788/2,715 | 4/4/2 | 0/0/0 | 0.011/0.012/0.011 |
| lore-req-04 | lore | A/A/A | 0.00 | 186,886/158,630/114,516 | 22/48/15 | 6/5/4 | 0.264/0.176/0.178 |
| lore-req-04 | utopia | C/C/C | 1.00 | 17,614/17,443/17,430 | 14/22/29 | 1/1/1 | 0.025/0.024/0.024 |
| lore-req-04 | utopia (evening) | C/C/C | 1.00 | 17,475/17,467/17,431 | 15/14/7 | 1/1/1 | 0.024/0.024/0.024 |
| lore-req-04 | utopia (night) | C/C/C | 1.00 | 17,487/17,437/17,497 | 12/8/8 | 1/1/1 | 0.024/0.015/0.016 |
| lore-req-05 | none | A/A/A | 0.00 | 2,796/2,789/2,764 | 3/11/3 | 0/0/0 | 0.012/0.012/0.012 |
| lore-req-05 | lore | C/C/P | 0.83 | 34,373/304,481/398,844 | 13/43/41 | 2/9/11 | 0.058/0.235/0.318 |
| lore-req-05 | utopia | C/C/C | 1.00 | 29,525/51,289/52,912 | 16/61/53 | 2/4/5 | 0.034/0.044/0.047 |
| lore-req-05 | utopia (evening) | C/C/C | 1.00 | 29,903/40,559/31,519 | 34/39/27 | 2/3/3 | 0.035/0.038/0.042 |
| lore-req-05 | utopia (night) | C/C/C | 1.00 | 29,859/29,984/52,849 | 11/13/31 | 2/2/6 | 0.035/0.015/0.039 |
| lore-code-01 | none | A/A/A | 0.00 | 2,729/2,785/2,790 | 2/3/2 | 0/0/0 | 0.011/0.012/0.012 |
| lore-code-01 | lore | P/C/W | 0.50 | 115,023/159,750/41,947 | 25/31/16 | 6/7/2 | 0.097/0.138/0.039 |
| lore-code-01 | utopia | C/C/C | 1.00 | 29,991/29,703/39,547 | 32/71/52 | 2/2/2 | 0.037/0.036/0.036 |
| lore-code-01 | utopia (evening) | C/C/C | 1.00 | 29,362/41,375/42,581 | 43/29/9 | 2/3/3 | 0.034/0.037/0.039 |
| lore-code-01 | utopia (night) | C/C/C | 1.00 | 29,370/30,194/29,989 | 11/13/8 | 2/2/2 | 0.034/0.029/0.008 |
| lore-code-02 | none | A/A/A | 0.00 | 2,803/2,782/2,792 | 3/4/2 | 0/0/0 | 0.012/0.012/0.012 |
| lore-code-02 | lore | A/A/A | 0.00 | 122,958/136,259/83,714 | 17/13/20 | 5/5/4 | 0.137/0.194/0.128 |
| lore-code-02 | utopia | C/C/W | 0.67 | 53,943/47,197/17,514 | 42/77/31 | 3/3/1 | 0.083/0.056/0.024 |
| lore-code-02 | utopia (evening) | W/P/C | 0.50 | 30,551/45,723/30,401 | 32/37/11 | 2/3/2 | 0.041/0.053/0.039 |
| lore-code-02 | utopia (night) | C/P/C | 0.83 | 54,033/64,398/30,450 | 19/28/10 | 3/4/2 | 0.084/0.049/0.020 |
| lore-code-03 | none | A/A/A | 0.00 | 2,787/2,768/2,794 | 5/5/6 | 0/0/0 | 0.012/0.012/0.012 |
| lore-code-03 | lore | A/A/C | 0.33 | 137,863/121,347/154,975 | 29/37/24 | 8/6/6 | 0.115/0.124/0.130 |
| lore-code-03 | utopia | C/C/C | 1.00 | 67,607/30,155/30,137 | 47/56/52 | 4/2/2 | 0.073/0.038/0.038 |
| lore-code-03 | utopia (evening) | C/C/C | 1.00 | 63,582/30,058/30,078 | 57/23/13 | 4/2/2 | 0.065/0.037/0.037 |
| lore-code-03 | utopia (night) | C/C/C | 1.00 | 68,163/30,085/29,948 | 16/8/11 | 4/2/2 | 0.074/0.007/0.018 |
| lore-code-04 | none | A/A/A | 0.00 | 2,790/2,779/2,880 | 2/3/2 | 0/0/0 | 0.012/0.012/0.013 |
| lore-code-04 | lore | P/P/P | 0.50 | 71,644/99,830/72,426 | 11/21/23 | 5/6/5 | 0.067/0.130/0.073 |
| lore-code-04 | utopia | P/P/P | 0.50 | 17,841/17,809/17,880 | 16/26/33 | 1/1/1 | 0.026/0.027/0.026 |
| lore-code-04 | utopia (evening) | P/P/P | 0.50 | 17,744/17,767/17,844 | 17/14/20 | 1/1/1 | 0.026/0.026/0.026 |
| lore-code-04 | utopia (night) | P/P/P | 0.50 | 17,820/17,808/47,499 | 7/9/15 | 1/1/3 | 0.026/0.006/0.046 |
| lore-hist-01 | none | A/A/A | 0.00 | 2,767/2,736/2,724 | 2/2/4 | 0/0/0 | 0.012/0.011/0.011 |
| lore-hist-01 | lore | C/C/C | 1.00 | 31,765/31,795/31,716 | 8/9/16 | 2/2/2 | 0.048/0.048/0.048 |
| lore-hist-01 | utopia | C/C/C | 1.00 | 17,023/17,008/17,066 | 20/23/26 | 1/1/1 | 0.023/0.023/0.023 |
| lore-hist-01 | utopia (evening) | C/C/C | 1.00 | 17,183/17,192/16,961 | 22/5/5 | 1/1/1 | 0.023/0.024/0.022 |
| lore-hist-01 | utopia (night) | C/C/C | 1.00 | 17,158/17,185/16,993 | 4/5/6 | 1/1/1 | 0.023/0.005/0.005 |
| lore-hist-02 | none | A/A/A | 0.00 | 2,696/2,691/2,694 | 2/3/3 | 0/0/0 | 0.011/0.011/0.011 |
| lore-hist-02 | lore | C/C/C | 1.00 | 29,010/28,968/28,985 | 9/9/14 | 2/2/2 | 0.035/0.035/0.035 |
| lore-hist-02 | utopia | C/C/C | 1.00 | 17,631/17,663/30,879 | 15/24/138 | 1/1/2 | 0.024/0.025/0.039 |
| lore-hist-02 | utopia (evening) | C/C/C | 1.00 | 17,702/17,681/18,484 | 25/10/51 | 1/1/2 | 0.025/0.025/0.028 |
| lore-hist-02 | utopia (night) | C/C/C | 1.00 | 17,665/17,660/17,679 | 6/4/5 | 1/1/1 | 0.025/0.004/0.016 |
| lore-hist-03 | none | A/A/A | 0.00 | 2,706/2,817/2,794 | 2/8/7 | 0/0/0 | 0.011/0.012/0.012 |
| lore-hist-03 | lore | C/C/C | 1.00 | 32,712/32,224/32,274 | 12/8/14 | 2/2/2 | 0.051/0.049/0.049 |
| lore-hist-03 | utopia | C/C/C | 1.00 | 17,602/17,642/17,590 | 16/26/29 | 1/1/1 | 0.025/0.025/0.025 |
| lore-hist-03 | utopia (evening) | C/C/C | 1.00 | 17,570/17,607/17,610 | 23/13/6 | 1/1/1 | 0.025/0.025/0.025 |
| lore-hist-03 | utopia (night) | C/C/C | 1.00 | 17,611/17,604/17,622 | 6/5/5 | 1/1/1 | 0.025/0.016/0.016 |
| lore-hist-04 | none | A/A/A | 0.00 | 2,778/2,724/2,780 | 3/2/4 | 0/0/0 | 0.012/0.011/0.012 |
| lore-hist-04 | lore | A/C/A | 0.33 | 51,792/29,038/103,414 | 11/12/15 | 3/2/5 | 0.061/0.036/0.090 |
| lore-hist-04 | utopia | C/C/C | 1.00 | 17,397/17,369/17,362 | 25/32/90 | 1/1/1 | 0.024/0.024/0.024 |
| lore-hist-04 | utopia (evening) | C/C/C | 1.00 | 17,388/17,364/17,365 | 18/11/5 | 1/1/1 | 0.024/0.024/0.024 |
| lore-hist-04 | utopia (night) | C/C/C | 1.00 | 17,408/17,374/17,374 | 6/7/7 | 1/1/1 | 0.024/0.015/0.015 |
| lore-trk-01 | none | A/A/A | 0.00 | 2,739/2,737/2,739 | 2/5/1 | 0/0/0 | 0.004/0.011/0.011 |
| lore-trk-01 | lore | A/A/A | 0.00 | 111,126/135,944/156,205 | 36/27/20 | 6/6/7 | 0.090/0.108/0.150 |
| lore-trk-01 | utopia | C/C/C | 1.00 | 17,389/17,442/17,432 | 17/36/61 | 1/1/1 | 0.024/0.024/0.024 |
| lore-trk-01 | utopia (evening) | C/C/C | 1.00 | 17,623/17,576/17,638 | 17/7/9 | 1/1/1 | 0.025/0.024/0.025 |
| lore-trk-01 | utopia (night) | C/C/C | 1.00 | 17,624/17,689/17,638 | 5/5/4 | 1/1/1 | 0.025/0.006/0.005 |
| lore-trk-02 | none | A/A/A | 0.00 | 2,741/2,742/2,743 | 2/3/3 | 0/0/0 | 0.011/0.012/0.012 |
| lore-trk-02 | lore | A/A/A | 0.00 | 135,505/130,940/139,349 | 18/32/31 | 7/5/6 | 0.140/0.142/0.150 |
| lore-trk-02 | utopia | C/C/C | 1.00 | 17,420/17,386/17,394 | 28/24/60 | 1/1/1 | 0.024/0.023/0.024 |
| lore-trk-02 | utopia (evening) | C/C/C | 1.00 | 17,394/17,413/17,407 | 14/8/5 | 1/1/1 | 0.024/0.024/0.024 |
| lore-trk-02 | utopia (night) | C/C/C | 1.00 | 17,392/17,442/17,384 | 7/4/10 | 1/1/1 | 0.024/0.015/0.004 |
| lore-trk-03 | none | A/A/A | 0.00 | 2,715/2,719/2,720 | 3/7/11 | 0/0/0 | 0.011/0.011/0.011 |
| lore-trk-03 | lore | A/A/A | 0.00 | 115,082/252,705/155,115 | 17/38/17 | 4/7/5 | 0.134/0.177/0.142 |
| lore-trk-03 | utopia | C/C/C | 1.00 | 17,175/17,239/17,185 | 17/24/42 | 1/1/1 | 0.023/0.023/0.023 |
| lore-trk-03 | utopia (evening) | C/C/C | 1.00 | 17,229/17,111/17,331 | 15/9/5 | 1/1/1 | 0.023/0.022/0.023 |
| lore-trk-03 | utopia (night) | C/C/C | 1.00 | 17,213/17,219/17,220 | 5/7/5 | 1/1/1 | 0.023/0.005/0.017 |
| lore-trk-04 | none | A/A/A | 0.00 | 2,705/2,716/2,714 | 2/8/3 | 0/0/0 | 0.011/0.011/0.011 |
| lore-trk-04 | lore | A/A/A | 0.00 | 101,100/170,132/88,975 | 16/53/16 | 6/8/5 | 0.080/0.115/0.093 |
| lore-trk-04 | utopia | C/C/C | 1.00 | 17,374/17,355/17,299 | 17/33/36 | 1/1/1 | 0.024/0.024/0.023 |
| lore-trk-04 | utopia (evening) | C/C/C | 1.00 | 17,364/17,464/17,415 | 23/11/8 | 1/1/1 | 0.024/0.024/0.024 |
| lore-trk-04 | utopia (night) | C/C/C | 1.00 | 16,953/17,022/17,004 | 5/13/5 | 1/1/1 | 0.022/0.014/0.014 |
| lore-learn-01 | none | P/P/P | 0.50 | 2,797/3,067/2,951 | 3/6/6 | 0/0/0 | 0.012/0.015/0.014 |
| lore-learn-01 | lore | C/C/C | 1.00 | 33,449/32,699/33,466 | 11/6/8 | 2/2/2 | 0.054/0.051/0.054 |
| lore-learn-01 | utopia | C/C/C | 1.00 | 18,078/17,784/17,788 | 24/33/25 | 1/1/1 | 0.027/0.026/0.026 |
| lore-learn-01 | utopia (evening) | C/C/C | 1.00 | 18,016/17,801/17,800 | 23/6/9 | 1/1/1 | 0.027/0.026/0.026 |
| lore-learn-01 | utopia (night) | C/C/C | 1.00 | 17,803/17,813/18,059 | 5/7/4 | 1/1/1 | 0.026/0.006/0.018 |
| lore-learn-02 | none | A/A/A | 0.00 | 2,719/2,738/2,730 | 3/3/3 | 0/0/0 | 0.011/0.011/0.011 |
| lore-learn-02 | lore | C/C/C | 1.00 | 44,304/30,243/30,311 | 7/17/15 | 2/2/2 | 0.099/0.042/0.043 |
| lore-learn-02 | utopia | C/C/C | 1.00 | 17,772/30,170/17,898 | 22/54/36 | 1/2/1 | 0.026/0.037/0.027 |
| lore-learn-02 | utopia (evening) | C/C/C | 1.00 | 17,855/17,836/17,828 | 19/13/6 | 1/1/1 | 0.027/0.027/0.027 |
| lore-learn-02 | utopia (night) | C/C/C | 1.00 | 17,847/17,875/17,845 | 7/9/7 | 1/1/1 | 0.027/0.007/0.007 |
| lore-learn-03 | none | A/A/A | 0.00 | 2,732/2,735/2,746 | 2/2/3 | 0/0/0 | 0.011/0.011/0.012 |
| lore-learn-03 | lore | A/C/C | 0.67 | 126,900/32,101/27,539 | 28/10/7 | 5/2/1 | 0.138/0.048/0.029 |
| lore-learn-03 | utopia | C/C/C | 1.00 | 17,648/17,612/17,614 | 23/20/24 | 1/1/1 | 0.025/0.024/0.024 |
| lore-learn-03 | utopia (evening) | C/C/C | 1.00 | 30,809/17,620/17,646 | 33/5/6 | 2/1/1 | 0.039/0.024/0.025 |
| lore-learn-03 | utopia (night) | C/C/C | 1.00 | 17,637/17,643/17,641 | 6/14/5 | 1/1/1 | 0.025/0.004/0.004 |
| lore-temp-01 | none | A/A/A | 0.00 | 2,721/2,704/2,704 | 3/4/3 | 0/0/0 | 0.011/0.011/0.011 |
| lore-temp-01 | lore | C/W/P | 0.50 | 158,327/151,570/63,023 | 30/43/28 | 7/5/3 | 0.097/0.192/0.062 |
| lore-temp-01 | utopia | W/W/W | 0.00 | 17,254/17,193/17,283 | 19/37/36 | 1/1/1 | 0.024/0.023/0.024 |
| lore-temp-01 | utopia (evening) | W/W/W | 0.00 | 17,292/17,223/17,236 | 22/10/7 | 1/1/1 | 0.024/0.024/0.024 |
| lore-temp-01 | utopia (night) | W/W/W | 0.00 | 17,248/17,231/17,208 | 10/10/6 | 1/1/1 | 0.024/0.006/0.005 |
| lore-temp-02 | none | A/A/A | 0.00 | 2,725/2,771/2,763 | 2/4/3 | 0/0/0 | 0.011/0.012/0.012 |
| lore-temp-02 | lore | C/C/C | 1.00 | 33,330/26,374/26,352 | 53/12/24 | 1/1/1 | 0.055/0.026/0.025 |
| lore-temp-02 | utopia | C/C/C | 1.00 | 17,522/17,500/17,526 | 32/26/38 | 1/1/1 | 0.025/0.025/0.025 |
| lore-temp-02 | utopia (evening) | C/C/C | 1.00 | 17,546/17,533/17,530 | 16/7/8 | 1/1/1 | 0.025/0.025/0.025 |
| lore-temp-02 | utopia (night) | C/C/C | 1.00 | 17,567/17,531/17,514 | 21/6/8 | 1/1/1 | 0.025/0.006/0.006 |
| lore-temp-03 | none | A/A/A | 0.00 | 2,705/2,705/2,693 | 3/2/2 | 0/0/0 | 0.011/0.011/0.011 |
| lore-temp-03 | lore | W/W/A | 0.00 | 74,854/25,950/74,145 | 19/8/15 | 3/2/4 | 0.100/0.024/0.071 |
| lore-temp-03 | utopia | C/C/C | 1.00 | 29,779/29,866/30,055 | 39/54/52 | 3/3/3 | 0.037/0.038/0.039 |
| lore-temp-03 | utopia (evening) | C/C/C | 1.00 | 30,013/43,183/29,919 | 40/14/9 | 3/3/3 | 0.038/0.046/0.038 |
| lore-temp-03 | utopia (night) | C/C/C | 1.00 | 30,020/29,180/30,156 | 10/10/11 | 3/2/3 | 0.038/0.016/0.021 |
| lore-none-01 | none | A/A/A | 1.00 | 2,708/2,705/2,703 | 2/2/2 | 0/0/0 | 0.011/0.011/0.011 |
| lore-none-01 | lore | A/P/C | 0.67 | 83,923/87,818/108,103 | 24/24/26 | 3/4/3 | 0.138/0.067/0.140 |
| lore-none-01 | utopia | C/C/C | 1.00 | 31,585/30,105/66,429 | 20/44/96 | 2/2/4 | 0.043/0.036/0.069 |
| lore-none-01 | utopia (evening) | C/C/P | 0.67 | 106,922/30,188/30,200 | 71/20/13 | 5/2/2 | 0.112/0.037/0.037 |
| lore-none-01 | utopia (night) | C/C/C | 1.00 | 47,682/153,040/30,166 | 14/36/7 | 3/7/2 | 0.057/0.130/0.006 |
| lore-none-02 | none | A/A/C | 1.00 | 2,701/2,700/2,695 | 3/11/3 | 0/0/0 | 0.011/0.011/0.011 |
| lore-none-02 | lore | C/A/A | 1.00 | 47,336/105,862/73,287 | 14/22/34 | 3/4/3 | 0.042/0.107/0.096 |
| lore-none-02 | utopia | C/C/A | 1.00 | 30,202/46,056/30,370 | 39/89/62 | 2/3/2 | 0.036/0.050/0.037 |
| lore-none-02 | utopia (evening) | C/C/C | 1.00 | 18,065/47,646/47,843 | 15/21/16 | 1/3/3 | 0.026/0.052/0.053 |
| lore-none-02 | utopia (night) | C/C/C | 1.00 | 31,558/47,579/47,814 | 7/23/11 | 2/3/3 | 0.039/0.019/0.008 |
| otto-dec-01 | none | A/A/A | 0.00 | 2,745/2,732/2,739 | 3/4/3 | 0/0/0 | 0.012/0.011/0.011 |
| otto-dec-01 | lore | P/P/P | 0.50 | 29,552/29,530/29,520 | 17/8/24 | 1/1/1 | 0.039/0.039/0.039 |
| otto-dec-01 | utopia | P/P/C | 0.67 | 17,328/17,406/17,372 | 27/40/46 | 1/1/1 | 0.024/0.025/0.025 |
| otto-dec-01 | utopia (evening) | C/P/P | 0.67 | 17,392/17,394/17,383 | 20/6/13 | 1/1/1 | 0.025/0.025/0.025 |
| otto-dec-01 | utopia (night) | P/P/P | 0.50 | 17,403/17,309/17,365 | 10/9/8 | 1/1/1 | 0.025/0.006/0.016 |
| otto-dec-02 | none | A/A/A | 0.00 | 2,740/2,740/2,732 | 3/2/3 | 0/0/0 | 0.012/0.012/0.011 |
| otto-dec-02 | lore | C/C/C | 1.00 | 27,442/26,422/26,313 | 11/10/10 | 2/1/1 | 0.032/0.027/0.027 |
| otto-dec-02 | utopia | C/C/C | 1.00 | 17,797/17,801/17,865 | 17/17/45 | 1/1/1 | 0.027/0.027/0.028 |
| otto-dec-02 | utopia (evening) | C/C/C | 1.00 | 17,833/17,824/17,842 | 18/6/7 | 1/1/1 | 0.027/0.027/0.027 |
| otto-dec-02 | utopia (night) | C/C/C | 1.00 | 17,797/17,886/17,835 | 10/10/6 | 1/1/1 | 0.027/0.008/0.008 |
| otto-dec-03 | none | A/A/A | 0.00 | 2,729/2,730/2,718 | 2/2/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-dec-03 | lore | C/C/C | 1.00 | 29,714/48,820/29,843 | 19/17/10 | 1/2/1 | 0.039/0.049/0.041 |
| otto-dec-03 | utopia | C/C/C | 1.00 | 79,875/32,620/59,680 | 99/25/26 | 4/3/3 | 0.127/0.049/0.061 |
| otto-dec-03 | utopia (evening) | C/C/P | 0.83 | 43,472/43,554/29,289 | 46/16/9 | 3/3/2 | 0.047/0.048/0.034 |
| otto-dec-03 | utopia (night) | C/C/C | 1.00 | 43,456/43,519/43,586 | 15/31/15 | 3/3/3 | 0.048/0.022/0.023 |
| otto-dec-04 | none | A/A/A | 0.00 | 2,744/2,735/2,737 | 3/3/2 | 0/0/0 | 0.012/0.011/0.011 |
| otto-dec-04 | lore | C/C/C | 1.00 | 32,462/32,486/32,363 | 8/9/12 | 2/2/2 | 0.051/0.051/0.051 |
| otto-dec-04 | utopia | C/C/C | 1.00 | 17,276/17,239/17,310 | 13/12/15 | 1/1/1 | 0.024/0.023/0.024 |
| otto-dec-04 | utopia (evening) | C/C/C | 1.00 | 17,373/17,293/27,035 | 15/5/11 | 1/1/2 | 0.025/0.024/0.025 |
| otto-dec-04 | utopia (night) | C/C/C | 1.00 | 17,288/17,313/27,037 | 8/7/6 | 1/1/2 | 0.024/0.006/0.007 |
| otto-dec-05 | none | A/A/A | 0.00 | 2,828/2,847/2,760 | 3/4/5 | 0/0/0 | 0.012/0.013/0.012 |
| otto-dec-05 | lore | C/C/C | 1.00 | 33,397/38,195/33,163 | 12/8/8 | 1/2/2 | 0.053/0.073/0.053 |
| otto-dec-05 | utopia | C/C/C | 1.00 | 17,495/17,709/17,651 | 8/12/12 | 1/1/1 | 0.024/0.025/0.025 |
| otto-dec-05 | utopia (evening) | C/C/C | 1.00 | 17,483/17,474/17,478 | 16/7/8 | 1/1/1 | 0.024/0.024/0.024 |
| otto-dec-05 | utopia (night) | C/C/C | 1.00 | 17,437/17,484/17,488 | 6/5/6 | 1/1/1 | 0.024/0.005/0.005 |
| otto-req-01 | none | A/A/A | 0.00 | 2,707/2,711/2,709 | 3/2/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-req-01 | lore | P/P/P | 0.50 | 27,945/27,967/28,755 | 9/22/9 | 1/1/2 | 0.033/0.033/0.036 |
| otto-req-01 | utopia | P/P/C | 0.67 | 29,538/35,941/35,872 | 14/21/11 | 2/2/2 | 0.036/0.062/0.062 |
| otto-req-01 | utopia (evening) | P/C/P | 0.67 | 29,465/35,896/49,912 | 33/9/18 | 2/2/3 | 0.035/0.062/0.072 |
| otto-req-01 | utopia (night) | P/C/C | 0.83 | 29,500/35,824/35,798 | 7/9/7 | 2/2/2 | 0.036/0.010/0.043 |
| otto-req-02 | none | A/A/A | 0.00 | 2,718/2,720/2,714 | 2/3/3 | 0/0/0 | 0.011/0.011/0.011 |
| otto-req-02 | lore | P/P/P | 0.50 | 99,608/45,832/25,402 | 28/9/5 | 4/3/2 | 0.094/0.052/0.021 |
| otto-req-02 | utopia | C/C/C | 1.00 | 30,671/30,726/30,718 | 18/16/11 | 2/2/2 | 0.039/0.040/0.040 |
| otto-req-02 | utopia (evening) | C/C/C | 1.00 | 46,058/46,340/31,698 | 110/14/9 | 3/3/3 | 0.043/0.053/0.045 |
| otto-req-02 | utopia (night) | C/P/C | 0.83 | 46,090/30,198/30,777 | 12/8/20 | 3/2/2 | 0.053/0.019/0.021 |
| otto-req-03 | none | A/A/A | 0.00 | 2,724/2,718/2,715 | 2/2/3 | 0/0/0 | 0.011/0.011/0.011 |
| otto-req-03 | lore | P/C/P | 0.67 | 77,512/48,290/109,235 | 14/14/39 | 4/3/5 | 0.075/0.062/0.094 |
| otto-req-03 | utopia | C/C/C | 1.00 | 17,410/17,389/17,442 | 13/8/14 | 1/1/1 | 0.024/0.024/0.024 |
| otto-req-03 | utopia (evening) | C/C/C | 1.00 | 17,399/17,402/17,387 | 19/5/5 | 1/1/1 | 0.024/0.024/0.024 |
| otto-req-03 | utopia (night) | C/C/C | 1.00 | 17,395/17,386/17,437 | 6/8/7 | 1/1/1 | 0.024/0.004/0.005 |
| otto-req-04 | none | A/A/A | 0.00 | 2,695/2,687/2,709 | 8/4/3 | 0/0/0 | 0.011/0.011/0.011 |
| otto-req-04 | lore | P/P/C | 0.67 | 31,387/31,656/95,518 | 8/17/30 | 2/2/4 | 0.046/0.047/0.122 |
| otto-req-04 | utopia | P/P/P | 0.50 | 17,578/17,583/30,398 | 14/16/28 | 1/1/2 | 0.025/0.025/0.039 |
| otto-req-04 | utopia (evening) | P/P/P | 0.50 | 17,535/17,657/30,425 | 17/8/9 | 1/1/2 | 0.025/0.026/0.039 |
| otto-req-04 | utopia (night) | P/P/P | 0.50 | 30,565/17,502/17,609 | 13/6/6 | 2/1/1 | 0.040/0.005/0.006 |
| otto-req-05 | none | A/A/A | 0.00 | 2,728/2,734/2,727 | 2/3/2 | 0/0/0 | 0.011/0.012/0.011 |
| otto-req-05 | lore | C/C/C | 1.00 | 31,418/31,404/31,416 | 15/10/9 | 1/1/1 | 0.046/0.046/0.046 |
| otto-req-05 | utopia | P/P/P | 0.50 | 29,528/18,066/29,556 | 12/10/20 | 2/1/2 | 0.033/0.027/0.033 |
| otto-req-05 | utopia (evening) | C/C/C | 1.00 | 29,739/44,235/31,670 | 24/9/9 | 2/3/2 | 0.033/0.047/0.041 |
| otto-req-05 | utopia (night) | P/P/P | 0.50 | 29,754/18,183/29,774 | 13/7/9 | 2/1/2 | 0.033/0.005/0.011 |
| otto-code-01 | none | A/A/A | 0.00 | 2,732/2,720/2,724 | 3/4/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-code-01 | lore | P/P/C | 0.67 | 25,897/25,066/89,910 | 12/8/15 | 2/1/4 | 0.024/0.020/0.105 |
| otto-code-01 | utopia | C/C/C | 1.00 | 17,396/17,399/17,400 | 12/13/10 | 1/1/1 | 0.024/0.024/0.024 |
| otto-code-01 | utopia (evening) | C/C/C | 1.00 | 17,395/17,406/17,397 | 19/8/4 | 1/1/1 | 0.024/0.024/0.024 |
| otto-code-01 | utopia (night) | C/C/C | 1.00 | 17,398/17,394/17,407 | 5/7/11 | 1/1/1 | 0.024/0.015/0.004 |
| otto-code-02 | none | A/A/A | 0.00 | 2,735/2,801/2,732 | 1/5/2 | 0/0/0 | 0.011/0.012/0.011 |
| otto-code-02 | lore | W/W/W | 0.00 | 30,031/30,068/109,145 | 18/23/18 | 2/2/6 | 0.041/0.042/0.102 |
| otto-code-02 | utopia | W/W/W | 0.00 | 37,317/37,246/59,065 | 16/14/32 | 2/2/3 | 0.069/0.068/0.079 |
| otto-code-02 | utopia (evening) | W/W/W | 0.00 | 58,580/37,163/37,068 | 43/10/8 | 3/2/2 | 0.077/0.067/0.066 |
| otto-code-02 | utopia (night) | W/W/W | 0.00 | 59,444/84,180/110,055 | 15/24/28 | 3/4/5 | 0.080/0.075/0.087 |
| otto-code-03 | none | A/A/A | 0.00 | 2,704/2,696/2,704 | 3/5/3 | 0/0/0 | 0.011/0.011/0.011 |
| otto-code-03 | lore | P/C/C | 0.83 | 55,833/25,589/24,722 | 19/6/8 | 4/2/1 | 0.065/0.022/0.018 |
| otto-code-03 | utopia | P/P/W | 0.33 | 17,462/17,554/42,024 | 16/12/28 | 1/1/3 | 0.025/0.026/0.037 |
| otto-code-03 | utopia (evening) | W/W/W | 0.00 | 16,579/28,176/16,594 | 19/8/6 | 1/2/1 | 0.021/0.033/0.021 |
| otto-code-03 | utopia (night) | W/W/W | 0.00 | 16,574/16,628/16,552 | 9/8/6 | 1/1/1 | 0.021/0.006/0.005 |
| otto-code-04 | none | A/A/A | 0.00 | 2,713/2,758/2,716 | 2/2/2 | 0/0/0 | 0.011/0.012/0.011 |
| otto-code-04 | lore | C/C/C | 1.00 | 27,578/27,449/50,382 | 6/23/9 | 2/2/3 | 0.031/0.030/0.051 |
| otto-code-04 | utopia | C/C/C | 1.00 | 17,813/17,826/17,810 | 12/12/9 | 1/1/1 | 0.025/0.026/0.025 |
| otto-code-04 | utopia (evening) | C/C/C | 1.00 | 17,767/17,845/17,795 | 15/12/5 | 1/1/1 | 0.025/0.026/0.025 |
| otto-code-04 | utopia (night) | C/C/C | 1.00 | 17,824/28,257/17,790 | 4/11/4 | 1/2/1 | 0.026/0.007/0.004 |
| otto-hist-01 | none | A/A/A | 0.00 | 2,725/2,722/2,725 | 6/4/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-hist-01 | lore | P/P/P | 0.50 | 53,937/35,788/111,619 | 18/31/24 | 3/2/6 | 0.058/0.063/0.101 |
| otto-hist-01 | utopia | C/C/C | 1.00 | 63,271/48,549/45,143 | 26/66/26 | 5/4/4 | 0.066/0.056/0.050 |
| otto-hist-01 | utopia (evening) | C/C/P | 0.83 | 44,818/44,135/30,104 | 104/9/9 | 4/3/2 | 0.047/0.045/0.038 |
| otto-hist-01 | utopia (night) | C/C/C | 1.00 | 45,202/60,402/56,769 | 54/48/15 | 4/4/3 | 0.048/0.043/0.038 |
| otto-hist-02 | none | A/A/A | 0.00 | 2,707/2,760/2,690 | 2/2/2 | 0/0/0 | 0.011/0.012/0.011 |
| otto-hist-02 | lore | A/A/P | 0.17 | 113,649/234,961/129,064 | 27/39/20 | 5/8/5 | 0.132/0.152/0.150 |
| otto-hist-02 | utopia | C/C/C | 1.00 | 18,190/17,463/18,164 | 42/12/58 | 2/1/2 | 0.028/0.024/0.028 |
| otto-hist-02 | utopia (evening) | C/C/C | 1.00 | 17,691/60,838/31,611 | 78/60/47 | 2/4/3 | 0.026/0.057/0.041 |
| otto-hist-02 | utopia (night) | C/C/C | 1.00 | 18,234/17,531/17,537 | 44/6/13 | 2/1/1 | 0.028/0.006/0.016 |
| otto-hist-03 | none | A/A/A | 0.00 | 2,706/2,699/2,709 | 2/2/4 | 0/0/0 | 0.011/0.011/0.011 |
| otto-hist-03 | lore | A/A/A | 0.00 | 58,093/76,142/58,516 | 18/18/20 | 3/4/3 | 0.077/0.068/0.078 |
| otto-hist-03 | utopia | C/C/C | 1.00 | 43,994/43,895/44,048 | 26/22/33 | 3/3/3 | 0.048/0.048/0.049 |
| otto-hist-03 | utopia (evening) | C/C/C | 1.00 | 39,346/29,363/30,124 | 33/13/10 | 2/2/2 | 0.037/0.035/0.038 |
| otto-hist-03 | utopia (night) | C/C/C | 1.00 | 29,438/29,291/29,361 | 10/12/9 | 2/2/2 | 0.036/0.016/0.016 |
| otto-hist-04 | none | A/A/A | 0.00 | 2,738/2,729/2,726 | 23/3/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-hist-04 | lore | P/P/W | 0.33 | 99,394/122,561/78,555 | 29/13/22 | 5/5/4 | 0.155/0.126/0.078 |
| otto-hist-04 | utopia | C/W/C | 0.67 | 40,826/17,227/27,868 | 21/13/22 | 3/1/2 | 0.041/0.023/0.029 |
| otto-hist-04 | utopia (evening) | C/C/C | 1.00 | 47,848/17,247/29,554 | 47/7/13 | 3/1/2 | 0.051/0.024/0.036 |
| otto-hist-04 | utopia (night) | C/C/C | 1.00 | 32,307/17,239/29,636 | 32/6/8 | 3/1/2 | 0.047/0.005/0.018 |
| otto-trk-01 | none | A/A/A | 0.00 | 2,716/2,715/2,706 | 2/18/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-trk-01 | lore | A/A/A | 0.00 | 310,261/129,690/204,753 | 34/18/49 | 10/7/9 | 0.255/0.143/0.127 |
| otto-trk-01 | utopia | C/C/C | 1.00 | 17,145/17,165/17,071 | 16/12/12 | 1/1/1 | 0.022/0.023/0.022 |
| otto-trk-01 | utopia (evening) | C/C/C | 1.00 | 17,151/17,172/17,126 | 17/6/5 | 1/1/1 | 0.023/0.023/0.023 |
| otto-trk-01 | utopia (night) | C/C/C | 1.00 | 17,160/17,194/17,086 | 4/7/6 | 1/1/1 | 0.023/0.005/0.004 |
| otto-trk-02 | none | A/A/A | 0.00 | 2,750/2,760/2,730 | 2/7/2 | 0/0/0 | 0.012/0.012/0.011 |
| otto-trk-02 | lore | A/A/A | 0.00 | 31,245/99,674/80,274 | 11/15/31 | 2/4/4 | 0.047/0.134/0.076 |
| otto-trk-02 | utopia | C/C/C | 1.00 | 17,624/17,574/17,545 | 13/9/16 | 1/1/1 | 0.025/0.025/0.025 |
| otto-trk-02 | utopia (evening) | C/C/C | 1.00 | 17,593/17,640/17,627 | 15/7/9 | 1/1/1 | 0.025/0.026/0.025 |
| otto-trk-02 | utopia (night) | C/C/C | 1.00 | 17,627/17,591/17,511 | 5/5/6 | 1/1/1 | 0.025/0.016/0.016 |
| otto-trk-03 | none | A/A/A | 0.00 | 2,751/2,744/2,731 | 2/6/3 | 0/0/0 | 0.012/0.011/0.011 |
| otto-trk-03 | lore | P/W/P | 0.33 | 57,082/201,271/116,443 | 9/40/43 | 3/7/6 | 0.090/0.171/0.139 |
| otto-trk-03 | utopia | C/C/C | 1.00 | 30,707/31,020/41,352 | 24/20/28 | 3/3/3 | 0.039/0.040/0.041 |
| otto-trk-03 | utopia (evening) | C/C/C | 1.00 | 30,724/41,824/17,409 | 47/16/5 | 3/3/1 | 0.040/0.042/0.024 |
| otto-trk-03 | utopia (night) | C/C/C | 1.00 | 30,074/30,721/30,739 | 16/11/9 | 2/3/3 | 0.036/0.031/0.031 |
| otto-trk-04 | none | A/A/A | 0.00 | 2,745/2,745/2,745 | 3/2/2 | 0/0/0 | 0.012/0.012/0.012 |
| otto-trk-04 | lore | W/W/W | 0.00 | 32,615/32,687/187,290 | 15/12/27 | 2/2/9 | 0.051/0.051/0.145 |
| otto-trk-04 | utopia | C/C/C | 1.00 | 17,624/17,622/17,754 | 11/14/14 | 1/1/1 | 0.025/0.025/0.026 |
| otto-trk-04 | utopia (evening) | C/C/C | 1.00 | 17,689/17,644/17,700 | 15/5/5 | 1/1/1 | 0.026/0.025/0.026 |
| otto-trk-04 | utopia (night) | C/C/C | 1.00 | 17,666/17,639/17,728 | 5/5/4 | 1/1/1 | 0.025/0.005/0.006 |
| otto-learn-01 | none | A/A/A | 0.00 | 2,722/2,731/2,716 | 2/24/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-learn-01 | lore | C/P/P | 0.67 | 47,457/47,362/64,134 | 17/10/13 | 2/2/3 | 0.044/0.043/0.079 |
| otto-learn-01 | utopia | C/C/C | 1.00 | 32,083/17,352/29,671 | 29/12/25 | 3/1/2 | 0.047/0.024/0.037 |
| otto-learn-01 | utopia (evening) | C/C/C | 1.00 | 17,361/27,005/29,373 | 22/7/8 | 1/2/2 | 0.025/0.025/0.035 |
| otto-learn-01 | utopia (night) | C/C/C | 1.00 | 17,356/17,241/17,336 | 11/6/7 | 1/1/1 | 0.025/0.005/0.015 |
| otto-learn-02 | none | A/A/A | 0.00 | 2,751/2,757/2,746 | 2/6/6 | 0/0/0 | 0.012/0.012/0.012 |
| otto-learn-02 | lore | W/C/W | 0.33 | 81,023/99,111/91,531 | 24/25/48 | 4/5/5 | 0.119/0.107/0.073 |
| otto-learn-02 | utopia | W/W/C | 0.33 | 17,390/17,533/17,712 | 14/11/15 | 1/1/1 | 0.024/0.026/0.026 |
| otto-learn-02 | utopia (evening) | W/W/W | 0.00 | 17,492/17,472/17,533 | 22/17/6 | 1/1/1 | 0.025/0.025/0.026 |
| otto-learn-02 | utopia (night) | W/W/W | 0.00 | 27,373/17,539/17,435 | 11/8/5 | 1/1/1 | 0.027/0.007/0.006 |
| otto-learn-03 | none | A/A/A | 0.00 | 2,834/2,869/2,865 | 7/5/3 | 0/0/0 | 0.012/0.013/0.013 |
| otto-learn-03 | lore | C/C/C | 1.00 | 41,378/63,017/41,810 | 14/18/30 | 2/3/2 | 0.089/0.093/0.091 |
| otto-learn-03 | utopia | C/C/C | 1.00 | 29,293/29,236/29,186 | 27/17/17 | 2/2/2 | 0.036/0.035/0.035 |
| otto-learn-03 | utopia (evening) | C/C/C | 1.00 | 29,215/29,269/29,186 | 29/10/9 | 2/2/2 | 0.035/0.036/0.035 |
| otto-learn-03 | utopia (night) | C/C/C | 1.00 | 29,237/29,298/29,233 | 10/20/8 | 2/2/2 | 0.035/0.027/0.009 |
| otto-temp-01 | none | A/A/A | 0.00 | 2,737/2,732/2,732 | 2/2/9 | 0/0/0 | 0.011/0.011/0.011 |
| otto-temp-01 | lore | P/C/C | 0.83 | 40,642/24,381/25,763 | 12/12/7 | 3/1/2 | 0.032/0.017/0.023 |
| otto-temp-01 | utopia | P/P/P | 0.50 | 59,733/27,827/17,681 | 56/13/15 | 3/2/1 | 0.107/0.027/0.026 |
| otto-temp-01 | utopia (evening) | P/P/P | 0.50 | 17,658/17,698/30,523 | 21/8/19 | 1/1/2 | 0.025/0.026/0.039 |
| otto-temp-01 | utopia (night) | P/P/P | 0.50 | 17,672/43,628/60,054 | 12/14/70 | 1/3/3 | 0.016/0.022/0.088 |
| otto-temp-02 | none | A/A/A | 0.00 | 2,694/2,687/2,697 | 3/4/3 | 0/0/0 | 0.011/0.011/0.011 |
| otto-temp-02 | lore | A/P/P | 0.33 | 165,458/36,523/64,424 | 25/7/29 | 8/2/3 | 0.133/0.066/0.084 |
| otto-temp-02 | utopia | P/P/P | 0.50 | 43,843/43,902/30,219 | 29/25/22 | 3/3/2 | 0.045/0.045/0.039 |
| otto-temp-02 | utopia (evening) | C/P/P | 0.67 | 30,165/30,194/30,227 | 33/10/10 | 2/2/2 | 0.038/0.039/0.039 |
| otto-temp-02 | utopia (night) | P/P/P | 0.50 | 30,232/30,216/30,258 | 11/9/12 | 2/2/2 | 0.020/0.020/0.009 |
| otto-temp-03 | none | A/A/A | 0.00 | 2,707/2,742/2,711 | 3/5/2 | 0/0/0 | 0.001/0.012/0.011 |
| otto-temp-03 | lore | P/P/P | 0.50 | 24,537/25,523/25,349 | 13/9/6 | 1/2/2 | 0.007/0.022/0.021 |
| otto-temp-03 | utopia | P/P/P | 0.50 | 17,598/17,473/17,659 | 14/12/13 | 1/1/1 | 0.025/0.025/0.026 |
| otto-temp-03 | utopia (evening) | P/P/W | 0.33 | 17,442/27,691/17,585 | 21/12/6 | 1/1/1 | 0.025/0.027/0.025 |
| otto-temp-03 | utopia (night) | P/P/P | 0.50 | 17,659/17,615/17,433 | 10/6/5 | 1/1/1 | 0.017/0.006/0.016 |
| otto-none-01 | none | A/A/A | 1.00 | 2,703/2,708/2,713 | 3/3/2 | 0/0/0 | 0.011/0.011/0.011 |
| otto-none-01 | lore | A/A/A | 1.00 | 191,622/57,045/199,288 | 21/10/43 | 7/4/6 | 0.123/0.071/0.114 |
| otto-none-01 | utopia | C/C/C | 1.00 | 88,996/144,828/152,645 | 32/45/45 | 5/7/6 | 0.103/0.118/0.145 |
| otto-none-01 | utopia (evening) | C/C/C | 1.00 | 95,788/87,638/90,489 | 80/18/21 | 6/5/6 | 0.112/0.098/0.110 |
| otto-none-01 | utopia (night) | C/C/C | 1.00 | 94,919/87,969/87,855 | 31/15/38 | 6/5/5 | 0.091/0.043/0.043 |
| otto-none-02 | none | A/A/A | 1.00 | 2,693/2,716/2,707 | 2/2/3 | 0/0/0 | 0.011/0.011/0.011 |
| otto-none-02 | lore | C/C/C | 1.00 | 70,242/46,695/45,103 | 18/8/13 | 4/3/3 | 0.075/0.055/0.049 |
| otto-none-02 | utopia | C/C/C | 1.00 | 60,709/78,138/58,483 | 34/48/44 | 4/5/4 | 0.057/0.066/0.053 |
| otto-none-02 | utopia (evening) | C/C/C | 1.00 | 43,549/77,250/78,569 | 59/38/19 | 3/4/5 | 0.045/0.059/0.066 |
| otto-none-02 | utopia (night) | C/C/C | 1.00 | 60,310/43,292/79,578 | 10/10/28 | 4/3/5 | 0.038/0.025/0.049 |
