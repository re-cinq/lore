# What could replace Lore, piece by piece

**For people deciding which parts of Lore to keep building and which to buy or borrow.** This records a survey, made on 2026-10-26, of the open-source projects and products that could stand in for Lore as a whole or for one of its components, with a verdict per component and a list of ideas worth taking. It follows the April study of Zep ([specs/zep-competitive-research.md](../../specs/zep-competitive-research.md)), which turned into four feature specs.

## Why we looked

Lore is many things at once: a context server for coding agents, an org memory, a traceability graph from spec statements to tests to code, a loop that implements backlog tickets, a reviewer, a merger, a triager, a digest writer, a workflow engine, an event bus and a web UI. Each of those has a market now that it did not have in March. Before adding more, it is worth knowing which parts are table stakes somebody else maintains, and which parts are the reason Lore exists.

## How to read the numbers

Star counts, licences, last-push dates and latest releases of every GitHub project come from the GitHub API, pulled on 2026-10-26. Prices and funding figures mostly come from aggregator sites and are marked "(aggregator)"; check vendor pages before budgeting. Eight claims rest on one secondary source and are marked "(unverified)".

## The short answer

Nothing covers Lore end to end. The nearest whole-product substitutes are two bundles:

- **GitHub's own stack**: Copilot coding agent for tickets, Copilot code review, the merge queue, Agentic Workflows for triage and Copilot Spaces for context. All run on GitHub's infrastructure, bill by usage, and know nothing of each other beyond the repository.
- **OpenHands Cloud Self-hosted**: the only mature coding agent with an MIT core and a Kubernetes runtime, plus PR-Agent for review and Kodiak for merging.

Neither bundle has a priority-labelled backlog loop that keeps its pull request mergeable, an org memory with temporal facts, the statement → test → coverage graph, or a digest that understands agent runs. Those four are Lore's reason to exist. Review, auto-merge, the event bus and the workflow engine are the parts a well-maintained project already does.

| Component | Verdict | Nearest replacement |
| --- | --- | --- |
| Shared org context over MCP | Keep | Unblocked (SaaS), Augment Context Engine |
| Agent memory | Keep, benchmark | Graphiti, Cognee |
| Knowledge graph (Utopia) | Keep | LightRAG, Graphiti |
| Vector store (pgvector) | Keep, consider pg_search | ParadeDB, pgvectorscale |
| Context evals | Keep runner, borrow metrics | DeepEval |
| Implementation loop | Keep, it is the product | Copilot coding agent, OpenHands |
| PR review | Keep | PR-Agent |
| Auto-merge | Adopt candidate | Kodiak, Bulldozer, Mergify |
| Issue triage | Watch | GitHub Agentic Workflows |
| Agent pods on Kubernetes | Adapt candidate | kubernetes-sigs/agent-sandbox |
| Workflow engine (floor) | Keep the YAML, note backends | Hatchet, DBOS |
| Event bus on Postgres | Keep | pg-boss |
| Spec → test → coverage | Keep, most unique piece | none |
| Digest and changelog | Keep | Gitmore, Swarmia |
| Web UI and spend | Keep, borrow budgets | Backstage, LiteLLM |
| Skills and MCP registry | Keep, adopt the install path | `npx skills`, MCP Registry |

## A. Shared org context over MCP

What Lore does: `lore_assemble_context` returns one token-budgeted block of conventions, ADRs, memories, facts and graph relationships for the repository the agent is in, from a hybrid vector and BM25 search over Postgres.

| Tool | Licence or price | Self-host | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [Unblocked](https://docs.getunblocked.com/unblocked-mcp) | SaaS, $19–29 per user per month (aggregator), $28M raised | No | Closest commercial match: Slack, Confluence, Jira and PR history served over MCP to Claude Code, Cursor and Copilot | SaaS only; agents cannot write memory back |
| [Augment Context Engine MCP](https://www.augmentcode.com/changelog/context-engine-mcp-in-ga) | SaaS, provider token rates plus about 40% (aggregator) | No | GA 2026-02-06; semantic code retrieval across many repos for Claude Code, Cursor, Zed | Code only, no ADR or convention curation, no assembly you control |
| [Sourcegraph MCP + Deep Search](https://sourcegraph.com/changelog/mcp-ga) | Enterprise only; Cody Free and Pro ended 2025-07 | Yes | Strongest cross-repo code search | Code only, expensive, no memory |
| [Nia](https://docs.trynia.ai/welcome) | Free tier, then SaaS; YC S25 | No | Indexes repos, doc sites and PDFs with a research agent | Built for external docs and packages |
| [Context7](https://github.com/upstash/context7) | MIT client, private backend; 63.7k stars | No | Version-specific library docs for agents | Public library docs only; a complement, not a replacement |
| [GitHub Copilot Spaces](https://github.blog/changelog/2025-09-24-copilot-spaces-is-now-generally-available/) | In Copilot plans | No | Curated repo files kept in sync, reachable through the GitHub MCP server | GitHub only, no retrieval control, no facts or graph |
| [Claude Code memory](https://code.claude.com/docs/en/memory) | Built in | n/a | Managed org `CLAUDE.md`, `.claude/rules/` and auto memory cover static conventions | Auto memory is machine-local and never shared |
| [Continue](https://github.com/continuedev/continue) | Apache-2.0; 36.3k stars | Yes | Open context-provider framework | A client, not an org server |

**Verdict: keep.** Unblocked is the product that validates the idea, and it cannot be self-hosted. Nothing combines retrieval over repo documents with memory agents write to.

## B. Agent memory

What Lore does: key-value memories with TTL, episodes that extract facts with temporal validity and confidence tiers, importance decay, nightly consolidation and a knowledge graph updated on every episode.

| Tool | Licence | Maturity | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [Graphiti / Zep](https://github.com/getzep/graphiti) | Apache-2.0; Zep Cloud paid | 32.2k stars, v0.31.2 on 2026-10-20; Thoughtworks Radar "Trial" 2026-04 | Closest feature match: episodes, bitemporal validity, invalidation instead of deletion, BM25 + vector + graph retrieval | Needs Neo4j, FalkorDB or Neptune; the MCP server has no auth; Zep Community Edition is deprecated |
| [Cognee](https://github.com/topoteretes/cognee) | Apache-2.0 | 32.8k stars, v1.6.1 on 2026-09-24; €7.5M seed 2026-02 | Runs on one Postgres with pgvector since 1.0; remember, recall, improve, forget API; MCP server | Postgres as graph store is "demo" in OSS; no temporal validity |
| [Mem0 / OpenMemory](https://github.com/mem0ai/mem0) | Apache-2.0 plus cloud | 67.8k stars, v2.2.1 on 2026-09-25; $24M raised | Most adopted memory API, time-aware retrieval | Algorithm is add-only since 2026-04, so no decay; one independent run scored the OSS edition 32.4% on LongMemEval against 93.4% self-reported for the hosted product |
| [Honcho](https://github.com/plastic-labs/honcho) | AGPL-3.0 | 7.8k stars, v3.4.0 on 2026-10-22 | Postgres + pgvector, hybrid BM25 and vector, Claude Code plugin | Models users and peers, not org knowledge; AGPL |
| [Letta](https://github.com/letta-ai/letta) | Apache-2.0 | 25.3k stars, last release 2026-05 | Self-editing memory blocks | An agent runtime, not a shared fact store |
| [MemOS](https://github.com/MemTensor/MemOS) | Apache-2.0 | 12.1k stars, v2.0.34 on 2026-09-23 | Memory cubes with an async scheduler | Heavy; decay undocumented |
| [Supermemory](https://github.com/supermemoryai/supermemory) | MIT | 31.4k stars, server v0.0.9 | Memory API with a graph and a Claude Code integration | Server still 0.0.x; mainly SaaS |
| [Basic Memory](https://github.com/basicmachines-co/basic-memory), [Memori](https://github.com/MemoriLabs/Memori), [LongMemory](https://github.com/CaviraOSS/LongMemory), [LangMem](https://github.com/langchain-ai/langmem), [A-MEM](https://github.com/agiresearch/A-mem) | AGPL, none, Apache, MIT, MIT | Small or slowing | Single-user stores and consolidation libraries | None has confidence tiers, decay and org scope together |

**Verdict: keep, and benchmark.** Graphiti is the one to measure against; it is what Lore's temporal facts were modelled on. The Mem0 result shows self-reported memory scores mean little, so Lore should score its own retrieval on a LongMemEval-style set before trusting it either.

## C. Knowledge graph from text

What Lore does: mirrors every ingested document, commit, issue, pull request and test link into a [Utopia](https://github.com/deeplethe/utopia) knowledge base per repository (ADR-052). Utopia is a single Rust binary on one Postgres, Apache-2.0, 8.5k stars, v0.1.0-rc9 on 2026-10-11, with ontology packs, bitemporal facts, three-stage entity resolution with a review queue, and one MCP server per base.

| Tool | Licence | Maturity | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [LightRAG](https://github.com/HKUDS/LightRAG) | MIT | 40.3k stars, v1.5.7 on 2026-09-02 | Postgres can hold all four stores; incremental updates and deletes | No bitemporality, no review queue |
| [Microsoft GraphRAG](https://github.com/microsoft/graphrag) | MIT | 36.5k stars, "maintenance mode" | Community summaries for global questions | Batch indexing, not incremental; no temporal facts |
| [Neo4j LLM Graph Builder](https://github.com/neo4j-labs/llm-graph-builder) | Apache-2.0 | 5.3k stars, v0.8.7 | Schema-guided extraction | Needs Neo4j; a Labs app |
| [nano-graphrag](https://github.com/gusye1234/nano-graphrag) | MIT | 4.0k stars, last push 2026-01 | Hackable | Dormant |
| Graphiti, Cognee | see B | | Episodic graph extraction | No ontology, no human review |

**Verdict: keep Utopia.** It is pre-1.0 and that is the risk, but none of the alternatives has its ontology plus review governance, and re-cinq maintains a fork.

## D. Vector store

What Lore does: PostgreSQL with pgvector (HNSW) and GIN for BM25, fused with Reciprocal Rank Fusion, one schema per team, on CloudNativePG.

| Tool | Licence | Maturity | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [pgvector](https://github.com/pgvector/pgvector) (baseline) | PostgreSQL | 23.5k stars, v0.8.7 | Iterative index scans fixed most over-filtering | Postgres full-text is not real BM25 |
| [ParadeDB pg_search](https://paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) | AGPL-3.0 | 9.5k stars, v0.26.3 on 2026-10-22 | Real BM25 inside Postgres with documented RRF over pgvector | AGPL terms |
| [pgvectorscale](https://github.com/timescale/pgvectorscale) | PostgreSQL | 3.2k stars, 0.9.1 | StreamingDiskANN and binary quantisation, drop-in | Only matters at a scale Lore is not at |
| [Qdrant](https://github.com/qdrant/qdrant) | Apache-2.0 | 35.3k stars, v1.20.0 | Wins on heavily filtered queries | A second datastore to run and back up |
| [Weaviate](https://github.com/weaviate/weaviate), [Milvus](https://github.com/milvus-io/milvus), [Vespa](https://github.com/vespa-engine/vespa), [OpenSearch](https://github.com/opensearch-project/OpenSearch) | BSD, Apache, Apache, Apache | Large | Native hybrid search | Much heavier to operate on GKE |
| [LanceDB](https://github.com/lancedb/lancedb), [Turbopuffer](https://turbopuffer.com) | Apache; commercial | Beta tags; serverless | Embedded or object-storage based | Beta; not self-hosted |

**Verdict: keep.** At the scale of org documents, joins, transactions and one backup story outweigh raw ANN speed. If hybrid quality is the bottleneck, pg_search is the upgrade.

## E. Context evals

What Lore does: a developer-run script samples ingested ADRs and specs, has a model write a question from each, assembles context, and reports found, answered and useful shares ([specs/context-evals](../../specs/context-evals/spec.md)).

| Tool | Licence | Maturity | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [DeepEval](https://github.com/confident-ai/deepeval) | Apache-2.0 | 19.1k stars, active | Synthesises goldens from documents; contextual relevancy and recall metrics; runs in pytest | Generic; needs wiring to the MCP output |
| [Ragas](https://github.com/vibrantlabsai/ragas) | Apache-2.0 | 16.2k stars, last push 2026-02 | Test-set generation from documents, the closest match to "questions from docs" | Activity slowing |
| [promptfoo](https://github.com/promptfoo/promptfoo) | MIT | 26.5k stars; OpenAI acquisition announced 2026-03 | YAML regression evals with context assertions | Leaning to red-teaming; neutrality uncertain |
| [Langfuse](https://github.com/langfuse/langfuse) | MIT core | 36.5k stars; ClickHouse-owned since 2026-01 | Self-hostable traces, datasets, judge evals | No question generation |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | Elastic License 2.0 | 12.0k stars | RAG relevance evals, free to self-host | Not OSI |
| [Braintrust](https://www.braintrust.dev), [LangSmith](https://www.langchain.com/enterprise-pricing) | Commercial | Well funded | Polished eval UIs | Self-host only at enterprise tier |

**Verdict: keep the runner, borrow the metrics.** DeepEval's contextual recall and relevancy could replace the hand-written "useful share" judge.

## F. Implementation loop

What Lore does: an issue with a `priority:*` label is picked one at a time per repository, implemented test-first by Claude Code or Gemini CLI in a pod, opened as a pull request, repaired until CI is green, rebased when behind main and kept mergeable after the run settles ([specs/implementation-loop](../../specs/implementation-loop/spec.md)).

| Tool | Licence or price | Self-host | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [GitHub Copilot coding agent](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/manage-pull-requests) | SaaS; AI credits plus Actions minutes since 2026-06-01 | No | Assign an issue, get a draft PR; fixes failing Actions and merge conflicts; `copilot /pr fix ci` loops to green | GitHub infrastructure only; CI waits for a human on draft PRs; no priority scheduler |
| [Claude Code Action](https://github.com/anthropics/claude-code-action) + [Claude Code on the web auto-fix](https://claude.com/resources/articles/preview-review-and-merge-with-claude-code) | MIT action (9.6k stars) plus a Claude plan | No | The agent Lore already runs; cloud auto-fix watches CI and review comments (2026-03) | GitHub runners or Anthropic cloud; no queue |
| [OpenHands](https://github.com/OpenHands/OpenHands) | MIT core (91.9k stars, v1.33.0 on 2026-10-23); self-hosted chart source-available, Teams $499 per month (aggregator) | Yes; Kubernetes runtime "work in progress" | An `openhands` label or mention opens a PR | No documented CI-fix or rebase loop; the old resolver repo is archived |
| [LangChain Open SWE](https://github.com/langchain-ai/open-swe) | MIT | Yes | Label-triggered plan, code, test, self-review, PR on LangGraph; 11.1k stars | Its own agent, third-party sandboxes, no merge upkeep |
| [Tembo](https://www.tembo.io) | SaaS; MIT Agent Studio control plane since 2026-05 | Yes | Picks backlog issues and opens PRs | Main trigger is a PR mention; CI loop undocumented |
| [OpenAI Codex cloud](https://developers.openai.com/codex/integrations/github), [Google Jules](https://jules.google), [Devin](https://devin.ai), [Cursor cloud agents](https://cursor.com/en-US/changelog), [Factory Droids](https://factory.ai), [Ona](https://ona.com), [Kilo for GitHub](https://kilo.ai/docs/code-with-ai/platforms/github) | SaaS | No (Devin Outposts run commands on your machines; Factory OpenCompute is private preview; Ona is VPC enterprise) | Issue- or PR-triggered PRs with a plan step | None runs your agent in your cluster; none keeps a PR mergeable after the fact (Jules fixing its own CI: unverified) |
| [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent), SWE-agent | MIT | Library | An agent core to embed | No GitHub, PR or CI lifecycle |
| Sweep, Codegen, Aider, Coder Tasks | | | | Sweep moved to JetBrains; Codegen discontinued 2026-01; Aider last pushed 2026-05; Coder Tasks deprecated 2026-09 |

**Verdict: keep; this is the product.** Copilot's `fix ci` and conflict resolution set the bar for what a ticket loop must do without a human.

## G. Pull request review

What Lore does: every open pull request is reviewed on the floor, the verdict is posted as the `lore/code-review` check run, a push re-checks the range, and a request for changes from a trusted reviewer is answered in-thread.

| Tool | Licence or price | Self-host | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [PR-Agent](https://github.com/The-PR-Agent/pr-agent) | MIT; 13.6k stars; moved from Qodo to a community foundation | Yes (Action, Docker, webhook) | Best open drop-in: `/review`, `/improve`, `/ask`, your own LLM keys | Comments, not a pass or fail check; no reply loop |
| [CodeRabbit](https://coderabbit.ai) | $24–72 per developer per month (aggregator) | Enterprise only | Market leader, chat replies on PRs | Review only |
| [Greptile](https://greptile.com) | $30 per seat plus credits (aggregator) | Helm on Enterprise | Whole-codebase context | Enterprise pricing to self-host |
| [GitHub Copilot code review](https://github.blog/changelog/2026-04-27-github-copilot-code-review-will-start-consuming-github-actions-minutes-on-june-1-2026/) | AI credits plus Actions minutes | No | Native | Comments, not blocking checks |
| [Cursor Bugbot](https://cursor.com/docs/bugbot/legacy-pricing) | About $1–1.5 per run (aggregator) | No | Autofix pushes fixes to the PR, a review-then-fix loop | Needs Cursor Teams |
| [Claude Code Review](https://www.codeant.ai/blogs/anthropic-claude-code-review) | About $15–25 per review (aggregator); launched 2026-03 | No | Multi-agent, same vendor as Lore's agent | Expensive; inline only, no approve or block |
| [Graphite Agent](https://graphite.com), [Macroscope](https://macroscope.com), [Codex review](https://developers.openai.com/codex/cloud/code-review), Qodo 2.0, Baz, Ellipsis, Korbit, [Sourcery](https://github.com/sourcery-ai/sourcery) | SaaS; Sourcery MIT | No | | Graphite is Cursor-owned since 2025-12; Macroscope bills $0.05 per KB |

Gemini Code Assist's consumer GitHub app shut down on 2026-07-17; review now needs paid seats. Lore runs Gemini in its own pods, so it is not affected, but the app is no longer a free fallback.

**Verdict: keep.** A check run plus an in-thread reply loop is ahead of every open option. PR-Agent is the fallback if the floor review were ever dropped.

## H. Auto-merge

What Lore does: with `auto_merge.enabled`, a sweep starts one run per open PR whose `lore/code-review` passed; a human station waits on CI, conflicts, threads, approval on the head and a minimum age; then the lore-reviewer App approves and arms native auto-merge ([specs/protected-branch-merge](../../specs/protected-branch-merge/spec.md)).

| Tool | Licence or price | Self-host | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [GitHub auto-merge + merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository) | Free | n/a | Merges when checks and reviews pass; queue keeps PRs current | No minimum age, no custom conditions |
| [Mergify](https://mergify.com/pricing) | Free to 5 users, then $21 per seat | No | Rules on age, labels and approvals; queue, auto-merge and auto-rebase in one | SaaS; `autoqueue` deprecated 2026-07 |
| [Kodiak](https://github.com/chdsbd/kodiak) | AGPL-3.0; 1.1k stars, pushed 2026-10-23 | Yes | `automerge` label plus branch update: the closest to "merge and keep rebased" | Small project; no batching |
| [Bulldozer](https://github.com/palantir/bulldozer) | Apache-2.0; 812 stars, pushed 2026-10-23 | Yes | Merges on label, checks and reviews; updates branches; YAML config | No minimum age without policy-bot |
| [Aviator](https://docs.aviator.co/manage/faqs/billing), [Graphite queue](https://graphite.com/docs/graphite-merge-queue), [Trunk Merge](https://trunk.io) | Free under 15 users then $12 per user; bundled; about $18 (aggregator) | No | Stack-aware queues | SaaS |
| [Renovate automerge](https://github.com/renovatebot/renovate) | AGPL-3.0 | Yes | `minimumReleaseAge`, `rebaseWhen` | Dependency PRs only |

bors-ng has been archived since 2024.

**Verdict: adopt candidate.** Kodiak or Bulldozer express most of the loop as a label plus required checks; the `lore/code-review` check already is a required check. What they cannot do is approve as the lore-reviewer App, and that is one station.

## I. Issue triage

What Lore does: the `issue-triage` line labels, assesses feasibility and asks the reporter questions ([specs/issue-triage](../../specs/issue-triage/spec.md)).

| Tool | Licence or price | Fit | Biggest gap |
| --- | --- | --- | --- |
| [GitHub Agentic Workflows](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows/) | Open source; runs on Actions with Copilot or another agent; public preview since about 2026-06 | Markdown-defined triage agents that label, close duplicates and comment, with "safe outputs" governing writes; Argo CD uses it | Preview; feasibility scoring is your own prompt |
| [GitHub duplicate detection + issue fields over MCP](https://github.blog/changelog/2026-06-18-duplicate-detection-and-issue-fields-mcp-support-for-github-issues) | Native, preview | Three likely duplicates on the new-issue form; agents can set priority fields | Shown to the reporter only |
| [actions/ai-inference labeler](https://github.blog/changelog/2025-09-05-github-actions-ai-labeler-and-moderator-with-the-github-models-inference-api) | Open Actions on GitHub Models, no API key | Cheap labelling and "ask for missing info" | One-shot prompts without repo context |
| [Linear Triage Intelligence](https://linear.app/enablement-guide/triage-intelligence) | In paid Linear | Semantic duplicates, suggested labels and assignees; an Agent API for Claude Code or Devin | Linear only |
| [Dosu](https://dosu.dev) | Free, Pro about $10–16 (aggregator) | Was the maintainer triage bot | Pivoted to docs in 2026 Q1 |
| PR-Agent `/similar_issue`, [github/issue-labeler](https://github.com/github/issue-labeler) | MIT | Embedding or regex matching | Narrow |

**Verdict: watch.** Agentic Workflows could run Lore's triage prompt in a repository that has no floor at all.

## J. Agent pods on Kubernetes

What Lore does: each agent visit runs in a pod of the external floor, started by [ai-agent-subsystem](https://github.com/re-cinq/ai-agent-subsystem), which renders the recipe, mounts the MCP gateway and fetches skills into `$HOME`.

| Tool | Licence or price | Maturity | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) | Apache-2.0 | 4.4k stars, v1.0.8 on 2026-10-22; GKE add-on | `Sandbox`, `SandboxTemplate`, `SandboxClaim` and `SandboxWarmPool` resources with gVisor or Kata: the direct replacement for a custom pod-per-agent controller | Lifecycle only; no recipe, task or GitHub logic |
| [kagent](https://github.com/kagent-dev/kagent) | Apache-2.0, CNCF sandbox | 4.1k stars | `Agent` and `ToolServer` resources with MCP and OpenTelemetry | Aimed at ops agents |
| [E2B](https://e2b.dev/docs/byoc) | Apache-2.0 infra; BYOC from about $3k per month (aggregator) | 14.6k stars; $37M raised | Firecracker sandboxes, self-hostable | Runs on Nomad; BYOC phones home |
| [Daytona](https://github.com/daytonaio/daytona) | Closed source since 2026-06; repo archived; fork [Nightona](https://github.com/bibekyess/nightona) | 71k stars frozen | Hosted product continues | Vendor risk for self-hosters |
| [Modal](https://modal.com), [Northflank](https://northflank.com/blog/best-sandboxes-for-coding-agents), [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/platform/pricing/), [Vercel Sandbox](https://docs.vercel.com/docs/vercel-sandbox/pricing), [Fly Sprites](https://simonwillison.net/2026/Jan/9/sprites-dev/), [Blaxel](https://blaxel.ai) | Usage-based | | Managed microVMs; Northflank offers BYOC | Not Kubernetes resources you own; Blaxel reportedly acquired by Baseten (unverified) |
| [Coder](https://github.com/coder/coder) | AGPL-3.0 | 17.2k stars | Kubernetes workspaces | Coupled to its workspace model |

**Verdict: adapt candidate.** A `SandboxWarmPool` would remove the pod start time the loop pays on every visit; the subsystem's init stays on top.

## K. Workflow engine

What Lore does: a pipeline file names a line of stations, agent and deterministic, with human waits, budgets, cancel and live streaming, run by [re-cinq/floor](https://github.com/re-cinq/floor) (ADR-049).

| Tool | Licence | Kubernetes self-host | Durable human wait | Fit | Biggest gap |
| --- | --- | --- | --- | --- | --- |
| [Hatchet](https://github.com/hatchet-dev/hatchet) | MIT; 8.2k stars, v0.110.5 | Helm; Postgres only | Event waits | Closest to Lore's stack: Postgres, TypeScript SDK, live run UI, concurrency limits | Code-defined, no YAML lines, no per-run LLM budget |
| [DBOS Transact](https://github.com/dbos-inc/dbos-transact-ts) | MIT | A library on your Postgres | Yes | No new infrastructure; checkpoints in the database Lore already has | No UI for lines or runs |
| [Temporal](https://github.com/temporalio/temporal) | MIT; 24.0k stars; $550M Series E 2026-09 | Helm, heavy | Signals and updates | The proven durable engine | Another stateful cluster; no YAML lines or agent concepts |
| [Kestra](https://github.com/kestra-io/kestra), [Windmill](https://github.com/windmill-labs/windmill) | Apache-2.0; AGPL plus Apache | Helm | Pause task; approval steps with N approvers | The only two whose definition model (YAML with approvals) matches the floor | General orchestrators; Kestra is a JVM |
| [Trigger.dev v4](https://github.com/triggerdotdev/trigger.dev) | Apache-2.0; 16.6k stars | Helm, about 6 vCPU and 12 GB | Waitpoints | TypeScript-native realtime streaming | Heavy self-host; no YAML |
| [Inngest](https://github.com/inngest/inngest) + [AgentKit](https://github.com/inngest/agent-kit) | SSPL server; AgentKit Apache-2.0 | Yes | `waitForEvent` | Best developer experience for step functions | Licence; AgentKit unchanged since 2026-04 |
| [Restate](https://github.com/restatedev/restate), [Mastra](https://github.com/mastra-ai/mastra), [Argo Workflows](https://github.com/argoproj/argo-workflows), [Conductor](https://github.com/conductor-oss/conductor), [Dapr Agents](https://github.com/dapr/dapr-agents), LangGraph Platform, Prefect, Dagster, CrewAI | BSL; Apache plus `ee/`; Apache; Apache; Apache; enterprise; Apache; Apache; MIT | Varies | Varies | Argo is YAML and pod-per-step, closest to "agent pod per station" | Coarse streaming, no budgets, clumsy resume |

**Verdict: keep the YAML and station model.** If the floor's durability ever needs replacing, DBOS or Hatchet go under it without changing the pipeline files.

## L. Event bus on Postgres

What Lore does: one `pipeline.events` table with a delivery row per subscriber, claimed with `FOR UPDATE SKIP LOCKED`, retried with backoff, dead-lettered, with cron ticks written by the stations service (ADR-015, ADR-044).

| Tool | Licence | Maturity | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [pg-boss](https://github.com/timgit/pg-boss) | MIT | 4.1k stars, v12.38.0 on 2026-10-13 | Node; SKIP LOCKED, backoff, dead-letter queues, cron, publish and subscribe fan-out: nearly one for one | No queryable event log with per-subscriber delivery status |
| [Graphile Worker](https://github.com/graphile/worker) | MIT | 2.4k stars, v0.18.0 | Fastest; LISTEN/NOTIFY, crontab | No fan-out or dead-letter queue |
| [pgmq](https://github.com/pgmq/pgmq) | PostgreSQL | 5.4k stars, v1.13.1 | SQS semantics in SQL with an archive table | An extension (check CloudNativePG images); no cron or fan-out |
| [pgflow](https://github.com/pgflow-dev/pgflow), [River](https://github.com/riverqueue/river), [Oban](https://github.com/oban-bg/oban), [Solid Queue](https://github.com/rails/solid_queue) | Apache, MPL, Apache, MIT | Small to mid | Reference designs | Supabase-tied; Go; Elixir; Ruby |
| [NATS JetStream](https://github.com/nats-io/nats-server) | Apache-2.0 | 20.9k stars | Durable consumers per subscriber | New infrastructure; no transactional enqueue with Postgres writes |

**Verdict: keep.** The custom bus is justified by the events-plus-deliveries audit trail; pg-boss is the fallback if that trail stops mattering.

## M. Spec to test to coverage

What Lore does: a statement in `spec.md` ends with `([validated by name](path#L42))`; the `lore-code-trace` binary runs the repository's own tests in CI, collects per-test coverage and posts the graph from statement to test to code ([specs/spec-test-coverage](../../specs/spec-test-coverage/spec.md)).

| Tool | Licence or price | Covers | Fit | Biggest gap |
| --- | --- | --- | --- | --- |
| [StrictDoc](https://github.com/strictdoc-project/strictdoc) | Apache-2.0; 0.30.4 on 2026-10-22 | Statement → test | Requirements as text with a traceability graph, source links and JUnit or gcov import | Its own `.sdoc` format; no per-test coverage |
| [Sphinx-Needs](https://github.com/useblocks/sphinx-needs) + [codelinks](https://github.com/useblocks/sphinx-codelinks) | MIT | Statement → code | Needs in RST or MyST linked from code comments; automotive-grade | Sphinx and Python centric; no runtime coverage |
| [OpenFastTrace](https://github.com/itsallcode/openfasttrace) | GPL-3.0 | Statement → test | Markdown requirement IDs with coverage tags; reports gaps | GPL, Java, static tags |
| [Doorstop](https://github.com/doorstop-dev/doorstop) | LGPL; v3.2 | Statement → statement | YAML items in Git with link validation | No test or coverage link |
| [Ketryx](https://ketryx.com/capabilities/traceability) | Commercial | Requirement → Git test → result | Closest commercial chain, with an MCP server for the traceability matrix | Regulated QMS focus, Jira-centric |
| [Jama](https://www.g2.com/compare/jama-connect-vs-polarion), Polarion, Helix ALM | Quote; from $42 per user (aggregator); quote | ALM | Enterprise traceability | Not Git-native |
| [Datadog Test Impact Analysis](https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/), [CloudBees Smart Tests](https://www.cloudbees.com/blog/how-cloudbees-smart-tests-works), [Tricentis SeaLights](https://www.tricentis.com/news/tricentis-acquires-sealights), [Codecov ATS](https://docs.codecov.com/docs/automated-test-selection) | Commercial | Test → code | Per-test coverage maps for test selection | None links to a statement; Codecov ATS is beta and Python only, and Codecov was reportedly sold to Harness (unverified) |
| [GitHub spec-kit](https://github.com/github/spec-kit), [Kiro specs](https://kiro.dev/docs/specs/) | MIT (143k stars); commercial | Spec → plan → tasks | The spec formats agents now see; Kiro uses EARS phrasing | Neither verifies tests against statements |

**Verdict: keep; the most unique piece.** No product has the chain from a Markdown statement to the project's own per-test coverage. Worth borrowing: EARS phrasing for statements, which makes them easier to test.

## N. Digest and changelog

What Lore does: a daily Slack digest per person and a weekly changelog per repository, both aware of agent runs ([specs/daily-digest](../../specs/daily-digest/spec.md), [specs/repo-changelog](../../specs/repo-changelog/spec.md)).

| Tool | Price | Fit | Biggest gap |
| --- | --- | --- | --- |
| [Swarmia](https://help.swarmia.com/notifications/team-notifications), [LinearB](https://linearb.helpdocs.io/article/nbxawb5lkl-what-is-a-daily-digest) | Vendr median about $14.7k per year; quote (aggregator) | Daily per-team Slack digests | Team and PR oriented; blind to agent runs |
| [Gitmore](https://gitmore.io/) | SaaS | AI daily or weekly reports per repo or contributor to Slack: the nearest match | Blind to runs, loops and spend |
| [DX](https://www.bnnbloomberg.ca/business/2025/09/18/atlassian-to-acquire-developer-productivity-platform-dx-for-us1-billion), [Axolo](https://axolo.co/pricing), Graphite | Atlassian-owned; about $8 per seat (aggregator); Cursor-owned | Channel per PR, daily recap | Same |
| [GitHub scheduled reminders](https://docs.github.com/en/organizations/managing-organization-settings/managing-scheduled-reminders-for-your-organization) | Free | Review queues to Slack | Open review requests only, five repos per reminder |
| [Changelog Summary](https://github.com/marketplace/actions/changelog-summary), [Git Weekly Summary](https://github.com/marketplace/actions/git-weekly-summary-action) actions | Open | LLM commit summary to Slack on a cron | No cross-repo or per-person view |
| [git-cliff](https://github.com/orhun/git-cliff), [release-please](https://github.com/googleapis/release-please), [changesets](https://github.com/changesets/changesets) | Apache, Apache, MIT | Deterministic release notes | Release notes, not digests |

**Verdict: keep.** None sees agent runs, which is what the digest is for.

## O. Web UI and spend

What Lore does: a Next.js UI for repositories, runs, loops, agent definitions and spend, reading only through lore-api.

| Tool | Licence or price | Fit | Biggest gap |
| --- | --- | --- | --- |
| [Backstage](https://github.com/backstage/backstage) | Apache-2.0; 34.7k stars | A host for catalog, run and agent plugins | Everything Lore-specific becomes a plugin to maintain |
| [Port](https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage), [Cortex](https://www.scalevp.com/press/cortex-raises--60m-to-build-the-future-of-developer-experience--series-c), OpsLevel, Roadie | $100M Series C; $60M Series C; quote; about $24 per developer (aggregator) | Port now pitches an agent catalog | SaaS; none runs agents or models runs |
| [LiteLLM](https://github.com/BerriAI/litellm) | MIT plus `enterprise/`; 62.1k stars | The proxy enforces per-key, team and user budgets, which map onto per-run budgets | A proxy hop; enterprise features paid |
| [Langfuse](https://github.com/langfuse/langfuse) | MIT core; ClickHouse-owned | Self-hosted traces plus cost | Needs ClickHouse, Redis and S3 beside Postgres |
| [OpenMeter](https://github.com/openmeterio/openmeter), [Portkey](https://github.com/Portkey-AI/gateway), [Helicone](https://github.com/Helicone/helicone) | Apache; MIT; Apache | Metering; gateway; observability | Kong-owned; reportedly Palo Alto-owned and stale (unverified); Mintlify-owned and in maintenance |

**Verdict: keep.** LiteLLM's budget keys are the one idea worth a look, for a hard per-run spend cap.

## P. Skills and MCP registry

What Lore does: the MCP gateway serves `agent-skills/` as tarballs per skill and per vendor hook bundle; the subsystem fetches them into a run's `$HOME`.

| Tool | Licence | Fit | Biggest gap |
| --- | --- | --- | --- |
| [Agent Skills spec](https://agentskills.io/specification) ([anthropics/skills](https://github.com/anthropics/skills), 183.9k stars) | Open standard, 30+ tools | The format Lore already serves | A format, not a registry |
| [skills.sh / `npx skills`](https://github.com/vercel-labs/skills) | MIT; 36.6k stars | Installs from `owner/repo`; could provision pods at boot | Public and Git-based; no private registry or versioned policy |
| [MCP Registry](https://github.com/modelcontextprotocol/registry) | Apache-2.0; 7.4k stars; API frozen at v0.1 | Self-hostable private sub-registry | MCP servers only, not skills |
| [Docker MCP Catalog](https://docs.docker.com/ai/mcp-catalog-and-toolkit.md) | Open registry | Custom org catalogs for containerised servers | No skills |
| [Smithery](https://smithery.ai), [Glama](https://glama.ai/mcp/gateway), [Tessl registry](https://tessl.io/registry) | AGPL CLI; SaaS; closed beta | Glama governs MCP access with per-tool control | Hosted; Smithery reportedly joined Arcade (unverified) |

**Verdict: keep serving; adopt the install path.** A Git repository of `SKILL.md` folders installed with `npx skills` is what the ecosystem converged on, and [specs/org-skills](../../specs/org-skills/spec.md) can point at it.

## What nothing else does

Four things came up empty in every search:

1. A backlog loop keyed on a priority label that keeps the pull request mergeable after the run, one ticket per repository at a time.
2. A traceability graph from a Markdown statement to the test that validates it to the code that test covers, fed by the project's own runner.
3. Org memory agents write to, with temporal facts, confidence tiers and decay, served next to the repository's documents.
4. A digest that knows what the agents did, not just what people merged.

## Ideas to take

| # | Idea | From | Effort |
| --- | --- | --- | --- |
| 1 | Express auto-merge as a label plus required checks, Kodiak-style, and copy its "update branch when behind" rule | Kodiak, Bulldozer, Mergify | Lower |
| 2 | Warm pools for agent pods through `SandboxWarmPool` | kubernetes-sigs/agent-sandbox | Medium |
| 3 | Real BM25 behind the hybrid search | ParadeDB pg_search | Lower |
| 4 | A hard per-run spend cap through one budgeted key per run | LiteLLM | Medium |
| 5 | Run the triage prompt as a GitHub Agentic Workflow where there is no floor | gh-aw | Lower |
| 6 | Contextual recall and relevancy metrics in the context evals | DeepEval | Lower |
| 7 | EARS phrasing guidance in `.lore/spec-standard.md` | Kiro | Lower |
| 8 | Score memory retrieval on a LongMemEval-style set before trusting self-reported numbers | Mem0 benchmark result | Medium |

## Sources

Context, memory, graph and evals: [Unblocked](https://docs.getunblocked.com/unblocked-mcp), [Augment](https://www.augmentcode.com/changelog/context-engine-mcp-in-ga), [Sourcegraph](https://sourcegraph.com/changelog/mcp-ga), [Nia](https://docs.trynia.ai/welcome), [Context7](https://github.com/upstash/context7), [Copilot Spaces](https://github.blog/changelog/2025-09-24-copilot-spaces-is-now-generally-available/), [Claude Code memory](https://code.claude.com/docs/en/memory), [Graphiti](https://github.com/getzep/graphiti), [Zep CE deprecation](https://help.getzep.com/ce-deprecation-notice), [Cognee](https://github.com/topoteretes/cognee), [Cognee seed](https://dealroom.co/news/125999-cognee-raises-7-5m-to-build-memory-layer-for-ai-agents/), [Mem0](https://github.com/mem0ai/mem0), [memory benchmark](https://dev.to/everest_an/-i-benchmarked-ai-agent-memory-in-2026-and-the-numbers-tell-a-different-story-than-the-marketing-2ae4), [Honcho](https://github.com/plastic-labs/honcho), [Letta](https://github.com/letta-ai/letta), [MemOS](https://github.com/MemTensor/MemOS), [Supermemory](https://github.com/supermemoryai/supermemory), [Utopia](https://github.com/deeplethe/utopia), [LightRAG](https://github.com/HKUDS/LightRAG), [GraphRAG](https://github.com/microsoft/graphrag), [pgvector](https://github.com/pgvector/pgvector), [ParadeDB hybrid search](https://paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual), [pgvectorscale](https://github.com/timescale/pgvectorscale), [Qdrant](https://github.com/qdrant/qdrant), [pgvector vs Qdrant](https://www.tigerdata.com/blog/pgvector-vs-qdrant), [DeepEval](https://github.com/confident-ai/deepeval), [Ragas test data](https://docs.ragas.io/en/stable/concepts/test_data_generation/), [promptfoo acquisition](https://securityboulevard.com/2026/03/openai-acquires-security-startup-promptfoo-to-fortify-ai-agents), [Langfuse joins ClickHouse](https://langfuse.com/blog/joining-clickhouse), [Phoenix licence](https://arize.com/docs/phoenix/self-hosting/license).

Agents, review, merge, triage and sandboxes: [background coding agents](https://www.sinatra.dev/blog/best-background-coding-agents), [Copilot merge conflicts](https://github.blog/changelog/2026-03-26-ask-copilot-to-resolve-merge-conflicts-on-pull-requests/), [Copilot CLI PRs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/manage-pull-requests), [Claude Code Action](https://github.com/anthropics/claude-code-action), [Claude Code auto-fix](https://claude.com/resources/articles/preview-review-and-merge-with-claude-code), [OpenHands self-hosted](https://www.openhands.dev/blog/openhands-cloud-self-hosted-secure-convenient-deployment-of-ai-software-development-agents), [Open SWE](https://blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent), [Codex GitHub](https://developers.openai.com/codex/integrations/github), [Tembo](https://rywalker.com/research/tembo), [Kilo for GitHub](https://blog.kilo.ai/p/introducing-kilo-for-github), [Codegen update](https://codegen.com/blog/an-update-on-codegen), [Coder Tasks](https://coder.com/docs/@main/ai-coder/tasks-core-principles), [PR-Agent](https://github.com/The-PR-Agent/pr-agent), [CodeRabbit pricing](https://www.usagepricing.com/blueprint/coderabbit), [Greptile](https://qodex.ai/blog/greptile-alternatives), [Copilot review billing](https://github.blog/changelog/2026-04-27-github-copilot-code-review-will-start-consuming-github-actions-minutes-on-june-1-2026/), [Bugbot pricing](https://cursor.com/docs/bugbot/legacy-pricing), [Gemini Code Assist deprecation](https://kieranmaynard.com/blog/gemini-code-assist-deprecation.html), [Claude Code Review](https://www.codeant.ai/blogs/anthropic-claude-code-review), [Mergify](https://next.mergify.com/pricing), [Kodiak](https://github.com/chdsbd/kodiak), [Bulldozer](https://github.com/palantir/bulldozer), [bors-ng](https://github.com/bors-ng/bors-ng), [Aviator](https://docs.aviator.co/manage/faqs/billing), [Agentic Workflows](https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/), [Argo CD triage](https://argo-cd.readthedocs.io/en/latest/developer-guide/github-agentics-issue-triage/), [duplicate detection](https://github.blog/changelog/2026-06-18-duplicate-detection-and-issue-fields-mcp-support-for-github-issues), [AI labeler](https://github.blog/changelog/2025-09-05-github-actions-ai-labeler-and-moderator-with-the-github-models-inference-api), [Linear triage](https://linear.app/enablement-guide/triage-intelligence), [Dosu pivot](https://pricingsaas.com/companies/dosu/diffs/2026Q1), [agent-sandbox on Kubernetes](https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox), [agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox), [kagent](https://github.com/kagent-dev/kagent), [E2B BYOC](https://e2b.dev/docs/byoc), [Daytona closed source](https://bex.co/blog/2026/09/09/daytona-closed-source-self-hostable-meaning), [sandbox comparison](https://northflank.com/blog/best-sandboxes-for-coding-agents), [Sprites](https://simonwillison.net/2026/Jan/9/sprites-dev/).

Engine, bus, traceability, digest, portal and registries: [Hatchet self-hosting](https://docs.hatchet.run/llms/self-hosting.md), [Inngest human in the loop](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop), [Trigger.dev Kubernetes](https://trigger.dev/docs/self-hosting/kubernetes), [Restate vs Temporal](https://restate.dev/vs/temporal), [DBOS](https://github.com/dbos-inc/dbos-transact-ts), [Mastra suspend and resume](https://mastra.ai/docs/workflows/suspend-and-resume), [Temporal funding](https://alpha-maven.com/story/venture-capital/temporal-raises-550m-funding), [Kestra Pause](https://kestra.io/plugins/core/flow/io.kestra.plugin.core.flow.Pause), [Windmill approvals](https://windmill.dev/docs/flows/flow_approval), [LangGraph Platform pricing](https://langchain.com/pricing-langgraph-platform), [Dapr Agents GA](https://www.cncf.io/announcements/2026/03/23/general-availability-of-dapr-agents-delivers-production-reliability-for-enterprise-ai/), [pg-boss](https://github.com/timgit/pg-boss), [Graphile Worker](https://github.com/graphile/worker), [pgmq](https://github.com/pgmq/pgmq), [StrictDoc](https://github.com/strictdoc-project/strictdoc), [Sphinx-Needs](https://github.com/useblocks/sphinx-needs), [OpenFastTrace](https://github.com/itsallcode/openfasttrace), [Doorstop](https://github.com/doorstop-dev/doorstop), [spec-kit](https://github.com/github/spec-kit), [EARS](https://en.wikipedia.org/wiki/Easy_Approach_to_Requirements_Syntax), [Kiro requirements](https://kiro.dev/fr/docs/specs/feature-specs/requirements-first/), [Ketryx](https://ketryx.com/capabilities/traceability), [Datadog TIA](https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/), [CloudBees Smart Tests](https://www.cloudbees.com/newsroom/cloudbees-smart-tests-brings-control-to-ai-generated-code), [Codecov ATS](https://docs.codecov.com/docs/automated-test-selection), [Swarmia](https://help.swarmia.com/notifications/team-notifications), [LinearB digest](https://linearb.helpdocs.io/article/nbxawb5lkl-what-is-a-daily-digest), [Gitmore](https://gitmore.io/), [GitHub reminders](https://docs.github.com/en/organizations/managing-organization-settings/managing-scheduled-reminders-for-your-organization), [Backstage](https://github.com/backstage/backstage), [Port funding](https://techcrunch.com/2025/12/11/port-raises-100m-at-800m-valuation-to-take-on-spotifys-backstage), [LiteLLM](https://github.com/BerriAI/litellm), [Helicone acquisition](https://ai-startups.dealroom.co/news/feed/mintlify-acquires-open-source-ai-observability-platform-helicone), [OpenMeter acquisition](https://konghq.com/company/press-room/press-release/kong-acquires-openmeter-to-unlock-ai-and-api-monetization-for-the-agentic-era), [Agent Skills spec](https://agentskills.io/specification), [skills.sh](https://vercel.com/docs/agent-resources/skills), [MCP Registry](https://github.com/modelcontextprotocol/registry), [MCP registries mid-2026](https://pub.towardsai.net/mcp-registries-in-mid-2026-one-upstream-won-2ce541b92036), [Docker MCP Catalog](https://docs.docker.com/ai/mcp-catalog-and-toolkit.md), [Glama](https://glama.ai/mcp/gateway).
