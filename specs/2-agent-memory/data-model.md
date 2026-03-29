# Data Model: Agent Runtime Memory

All entities live in a `memory` schema in the existing lore database.

## Entities

### Memory

The core entity representing a key-value memory entry owned by an agent.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, auto-generated |
| agent_id | TEXT | NOT NULL, indexed |
| key | TEXT | NOT NULL |
| value | TEXT | NOT NULL |
| embedding | VECTOR(768) | Nullable (populated async) |
| version | INTEGER | NOT NULL, monotonic per agent+key |
| is_deleted | BOOLEAN | DEFAULT false |
| pool | TEXT | NULL for private, pool name for shared |
| ttl_seconds | INTEGER | NULL for permanent |
| expires_at | TIMESTAMPTZ | NULL for permanent, computed from ttl |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| metadata | JSONB | Optional extra data |

**Unique constraint:** `(agent_id, key, version)`

**Indexes:**
- HNSW on `embedding`
- GIN on `to_tsvector(value)`
- btree on `(agent_id, key)`

### Fact

An extracted fact derived from a parent memory entry. Facts are
generated asynchronously when `extract_facts` is enabled on write.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| memory_id | UUID | FK to Memory |
| fact_text | TEXT | NOT NULL |
| embedding | VECTOR(768) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:**
- HNSW on `embedding`

### Snapshot

A point-in-time reference snapshot of an agent's memory state.
Snapshots do not copy data; they store references to specific
memory versions.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| agent_id | TEXT | NOT NULL |
| trigger | TEXT | manual or auto |
| memory_refs | JSONB | Array of {memory_id, version} |
| memory_count | INTEGER | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

### AuditEntry

Append-only log of all memory operations for observability and
debugging.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| agent_id | TEXT | NOT NULL |
| operation | TEXT | write, read, search, delete, snapshot, restore |
| key | TEXT | Nullable |
| pool | TEXT | Nullable |
| metadata | JSONB | Extra context (query, results count, etc.) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:**
- btree on `(agent_id, created_at)`

## Entity Relationships

```
Memory 1──→N Fact
  Parent memory to extracted facts.

Snapshot ──→N Memory
  Reference-based, via memory_refs JSONB.

AuditEntry ──→ Memory
  Via key, loose reference.
```

- **Memory 1 to N Fact** -- A single memory entry can produce multiple
  extracted facts. The `memory_id` FK on Fact points back to the
  source Memory row.

- **Snapshot to N Memory** -- A snapshot references multiple memory
  entries by ID and version through the `memory_refs` JSONB array.
  This is a logical (not FK-enforced) relationship so that snapshots
  survive memory deletions.

- **AuditEntry to Memory** -- Audit entries reference memories loosely
  via `key` (and optionally `agent_id`). This is intentionally not a
  foreign key so the audit log remains intact even after memory
  cleanup.

## State Transitions (Memory)

```
created ──→ active          (on write)
active  ──→ updated         (new version created, old version preserved)
active  ──→ soft-deleted    (is_deleted=true, excluded from search)
active  ──→ expired         (ttl reached, excluded from search, cleanup deletes)
```

- **created to active**: When `write_memory` inserts a new row, it
  becomes the active version for that agent+key pair.

- **active to updated**: A subsequent `write_memory` with the same key
  creates a new row with an incremented version. The previous version
  is preserved for history and snapshot references.

- **active to soft-deleted**: `delete_memory` sets `is_deleted=true`
  on the current version. The row remains in the database for audit
  purposes but is excluded from all read and search operations.

- **active to expired**: When `NOW() >= expires_at`, the memory is
  treated as soft-deleted in queries. A background cleanup process
  hard-deletes expired rows after a configurable retention period.
