# Data Model: Agent Runtime Memory

All entities live in a `memory` schema in the existing lore database.

> **Updated 2026-06-01.** This file reflects the shipped implementation,
> which diverged significantly from the original design. Major additions:
> `episodes`, `entities`, `edges`, `fact_conflicts`; extensive new fields
> on `facts` (confidence tiers, temporal validity, decay metadata).
> `shared_pools` and `snapshots` exist in the DB but are internal — no
> MCP tools expose them directly. See
> [spec.md § Divergences](./spec.md#divergences-from-original-design).

---

## Entities

### memories

The core entity representing a key-value memory entry. Memories are
**repo-scoped** by default — when the caller is inside a git repo with
a GitHub remote, writes are tagged with that repo. The same key can exist
under different repos without collision.

| Field         | Type        | Constraints                                     |
|---------------|-------------|-------------------------------------------------|
| id            | UUID        | PK, auto-generated                              |
| agent_id      | TEXT        | NOT NULL, indexed                               |
| key           | TEXT        | NOT NULL                                        |
| value         | TEXT        | NOT NULL                                        |
| embedding     | VECTOR(768) | Nullable; HNSW indexed; populated async         |
| version       | INTEGER     | NOT NULL, monotonic per agent+key (or repo+key) |
| is_deleted    | BOOLEAN     | DEFAULT false                                   |
| pool_id       | UUID        | NULL = private; FK → shared_pools               |
| ttl_seconds   | INTEGER     | NULL = permanent                                |
| expires_at    | TIMESTAMPTZ | Computed from ttl_seconds on write              |
| repo          | TEXT        | NULL if unscoped; auto-detected from git remote |
| created_at    | TIMESTAMPTZ | DEFAULT NOW()                                   |

**Unique constraint:** `(agent_id, key, version)` (or `(repo, key, version)` when repo is set)

**Indexes:**
- HNSW on `embedding`
- GIN on `to_tsvector(value)`
- btree on `(agent_id, key)`
- btree on `(repo, key)` (conditional)

---

### memory_versions

Append-only history table. Every `write_memory` call that increments the
version inserts a row here. Enables `read_memory(key, version="all")`.

| Field     | Type        | Constraints         |
|-----------|-------------|---------------------|
| memory_id | UUID        | FK → memories       |
| version   | INTEGER     | NOT NULL            |
| value     | TEXT        | NOT NULL            |
| embedding | VECTOR(768) | Nullable            |
| created_at| TIMESTAMPTZ | DEFAULT NOW()       |

---

### facts

An atomic fact extracted from a memory or episode by the LLM extraction
pipeline. Facts are independently embedded and carry temporal validity and
confidence tiers so the system can surface contradictions and decay
stale knowledge.

| Field             | Type        | Notes                                                  |
|-------------------|-------------|--------------------------------------------------------|
| id                | UUID        | PK                                                     |
| memory_id         | UUID        | FK → memories; NULL for episode-sourced facts          |
| episode_id        | UUID        | FK → episodes; NULL for memory-sourced facts           |
| fact_text         | TEXT        | NOT NULL                                               |
| embedding         | VECTOR(768) | HNSW indexed                                           |
| confidence        | TEXT        | `verified` / `observed` / `inferred` / `stale`         |
| valid_from        | TIMESTAMPTZ | When this fact became valid                            |
| valid_to          | TIMESTAMPTZ | NULL = still valid; set on contradiction detection     |
| invalidated_by    | UUID        | FK → facts (the superseding fact)                      |
| retrieval_count   | INTEGER     | Incremented fire-and-forget on every search hit        |
| last_retrieved_at | TIMESTAMPTZ | Updated on every search hit                            |
| half_life_days    | FLOAT       | Decay rate; extended +2 (cap 365) on each retrieval   |
| created_at        | TIMESTAMPTZ | DEFAULT NOW()                                          |

**Confidence lifecycle:**
- `observed` — default for episode-sourced extractions.
- `inferred` — for memory-sourced extractions.
- `verified` — manually confirmed by a human.
- `stale` — auto-applied after 30 days of zero retrieval; reverts to
  `observed` on next retrieval.

**Contradiction detection:** at extraction time each new fact is compared
against existing valid facts by cosine similarity. If similarity >= 0.92,
the old fact's `valid_to` is set, `invalidated_by` is linked, and a row
is inserted into `fact_conflicts` for audit.

---

### episodes

Raw text blobs ingested via `write_episode`. The source of truth for
passive knowledge capture. Content is deduplicated by SHA-256 hash.
Fact and knowledge-graph extraction run asynchronously after insert.

| Field        | Type        | Notes                                                    |
|--------------|-------------|----------------------------------------------------------|
| id           | UUID        | PK                                                       |
| agent_id     | TEXT        | NOT NULL                                                 |
| content      | TEXT        | NOT NULL (privacy-filtered via sanitizeContent before store) |
| content_hash | TEXT        | SHA-256 of content; used for dedup (`ON CONFLICT DO NOTHING`) |
| source       | TEXT        | `session`, `pr-review`, `ci`, `manual`                   |
| ref          | TEXT        | Nullable; external ref, e.g. `owner/repo#42`             |
| embedding    | VECTOR(768) | Populated async                                          |
| created_at   | TIMESTAMPTZ | DEFAULT NOW()                                            |

**Unique constraint:** `(agent_id, content_hash)` — prevents ingesting the
same episode twice.

---

### entities

Named entities extracted from episodes and memories by the graph
extraction pipeline. Entity names are normalized to lowercase.

| Field       | Type        | Notes                                                     |
|-------------|-------------|-----------------------------------------------------------|
| id          | UUID        | PK                                                        |
| name        | TEXT        | NOT NULL; normalized lowercase                            |
| entity_type | TEXT        | `service`, `team`, `technology`, `concept`, `person`      |
| repo        | TEXT        | Nullable; scopes entity to a repo when known              |
| updated_at  | TIMESTAMPTZ |                                                           |
| created_at  | TIMESTAMPTZ | DEFAULT NOW()                                             |

**Unique constraint:** `(name, entity_type, COALESCE(repo, ''))`

---

### edges

Directed, typed relationships between entities. Both endpoints carry
temporal validity. When the same `(source, relation_type)` pair is
updated with a different target, the old edge gets `valid_to = now()`
(auto-invalidation).

| Field             | Type        | Notes                                            |
|-------------------|-------------|--------------------------------------------------|
| id                | UUID        | PK                                               |
| source_id         | UUID        | FK → entities                                    |
| target_id         | UUID        | FK → entities                                    |
| relation_type     | TEXT        | `uses`, `owns`, `depends-on`, `replaced-by`, `part-of`, `implements` |
| source_episode_id | UUID        | Nullable; FK → episodes (provenance)             |
| source_memory_id  | UUID        | Nullable; FK → memories (provenance)             |
| valid_from        | TIMESTAMPTZ | DEFAULT NOW()                                    |
| valid_to          | TIMESTAMPTZ | NULL = still valid                               |
| created_at        | TIMESTAMPTZ | DEFAULT NOW()                                    |

---

### fact_conflicts

Immutable record created just before a fact is invalidated by
contradiction detection. Gives context assembly visibility into disputed
knowledge (prefixed `[CONFLICT]` in assembled context).

| Field       | Type  | Notes                   |
|-------------|-------|-------------------------|
| old_fact_id | UUID  | FK → facts (invalidated)|
| new_fact_id | UUID  | FK → facts (superseding)|
| similarity  | FLOAT | Cosine similarity score |
| created_at  | TIMESTAMPTZ | DEFAULT NOW()   |

---

### snapshots

Point-in-time reference snapshots. Stores memory IDs + version numbers,
not copies. Internal implementation — **not exposed as MCP tools**.

| Field        | Type        | Constraints                         |
|--------------|-------------|-------------------------------------|
| id           | UUID        | PK                                  |
| agent_id     | TEXT        | NOT NULL                            |
| trigger      | TEXT        | `manual` or `auto`                  |
| memory_refs  | JSONB       | Array of `{memory_id, version}`     |
| memory_count | INTEGER     |                                     |
| created_at   | TIMESTAMPTZ | DEFAULT NOW()                       |

---

### shared_pools

Named memory namespaces. Pool functions (`sharedWrite`, `sharedRead`)
exist in `memory.ts` but are **not exposed as MCP tools**. Agents reach
shared pools via the `pool=` parameter on `write_memory` /
`search_memory`, which resolves the name to a `pool_id`.

| Field      | Type        | Constraints          |
|------------|-------------|----------------------|
| id         | UUID        | PK                   |
| name       | TEXT        | UNIQUE, NOT NULL     |
| created_by | TEXT        | agent_id of creator  |
| created_at | TIMESTAMPTZ | DEFAULT NOW()        |

---

### audit_log

Append-only record of all memory operations.

| Field      | Type        | Constraints                                              |
|------------|-------------|----------------------------------------------------------|
| id         | UUID        | PK                                                       |
| agent_id   | TEXT        | NOT NULL                                                 |
| operation  | TEXT        | `write`, `read`, `search`, `delete`, `write_episode`     |
| memory_key | TEXT        | Nullable                                                 |
| metadata   | JSONB       | Query text, result count, episode_id, etc.               |
| created_at | TIMESTAMPTZ | DEFAULT NOW()                                            |

**Indexes:**
- btree on `(agent_id, created_at)`

---

## Entity Relationships

```
memories 1──→N memory_versions
  Full version history; version "all" reads this table.

memories 1──→N facts   (via memory_id)
episodes 1──→N facts   (via episode_id)
  Fact extraction sources are either a memory write or an episode ingest.

facts 1──→1 facts      (invalidated_by self-reference)
  Contradiction chain: each invalidated fact points to its replacement.

episodes ──→ fact_conflicts (via old_fact_id / new_fact_id on facts)
  Conflicts arise from episode-sourced fact extraction.

episodes 1──→N edges   (via source_episode_id)
memories 1──→N edges   (via source_memory_id)
  Provenance of each graph edge.

entities N──→M entities  (via edges table)

memories N──→1 shared_pools  (via pool_id)
```

---

## State Transitions

### Memory

```
created ──→ active          (on write_memory)
active  ──→ updated         (new version created, old version preserved in memory_versions)
active  ──→ soft-deleted    (is_deleted=true, excluded from search)
active  ──→ expired         (ttl reached, excluded from queries, cleanup hard-deletes)
```

### Fact

```
extracted ──→ observed/inferred   (default on create)
observed  ──→ stale               (30+ days without retrieval, daily job)
stale     ──→ observed            (revived on next search hit)
any       ──→ invalidated         (valid_to set by contradiction detection)
any       ──→ verified            (manual promotion, no automated path)
```

### Graph Edge

```
created   ──→ valid     (on upsert)
valid     ──→ invalid   (valid_to set when same source+relation updated with different target)
```
