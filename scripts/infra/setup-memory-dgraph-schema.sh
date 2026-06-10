#!/usr/bin/env bash
set -euo pipefail

# Apply the memory Dgraph DQL schema — the type system + predicate/index
# definitions from specs/memory-dgraph-migration/data-model.md — to a running
# Dgraph Alpha. The Dgraph analogue of scripts/infra/setup-local-schema.sh.
#
# Idempotent: Dgraph's /alter re-applies the same schema as a no-op (no data
# touched, indexes converge to the declared set). Invoked from dev-local.sh
# after the lore-dgraph container is healthy; also runnable standalone via
# `npm run dgraph:schema`.
#
# Targets the Alpha HTTP endpoint (default: local dev on :8081 — see
# compose.yaml). Override for another host/port:  DGRAPH_HTTP=http://host:8080

DGRAPH_HTTP="${DGRAPH_HTTP:-http://localhost:8081}"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl not found — needed to apply the Dgraph schema"

# Predicate + index definitions first, then the type system that references them.
SCHEMA=$(cat <<'DQL'
Memory.xid: string @index(hash) @upsert .
MemoryVersion.xid: string @index(hash) @upsert .
Fact.xid: string @index(hash) @upsert .
FactConflict.xid: string @index(hash) @upsert .
Episode.xid: string @index(hash) @upsert .
Entity.xid: string @index(hash) @upsert .
GraphRel.xid: string @index(hash) @upsert .
SharedPool.xid: string @index(hash) @upsert .
Snapshot.xid: string @index(hash) @upsert .
AuditLog.xid: string @index(hash) @upsert .

Memory.agent_id: string @index(hash) .
Memory.key: string @index(hash, term) .
Memory.value: string @index(fulltext) .
Memory.embedding: float32vector @index(hnsw(metric:"cosine")) .
Memory.version: int .
Memory.is_deleted: bool @index(bool) .
Memory.pool: uid @reverse .
Memory.ttl_seconds: int .
Memory.expires_at: dateTime @index(hour) .
Memory.repo: string @index(hash) .
Memory.retrieval_count: int .
Memory.last_retrieved_at: dateTime .
Memory.half_life_days: int .
Memory.metadata: string .
Memory.created_at: dateTime @index(hour) .
Memory.versions: [uid] @reverse @count .
Memory.facts: [uid] @reverse @count .

MemoryVersion.memory: uid @reverse .
MemoryVersion.version: int @index(int) .
MemoryVersion.value: string .
MemoryVersion.embedding: float32vector .
MemoryVersion.created_at: dateTime .

Fact.text: string @index(fulltext) .
Fact.embedding: float32vector @index(hnsw(metric:"cosine")) .
Fact.valid_from: dateTime @index(hour) .
Fact.valid_to: dateTime @index(hour) .
Fact.active: bool @index(bool) .
Fact.invalidated_by: uid .
Fact.confidence: string @index(hash) .
Fact.retrieval_count: int .
Fact.last_retrieved_at: dateTime .
Fact.half_life_days: int .
Fact.memory: uid @reverse .
Fact.episode: uid @reverse .
Fact.agent_id: string @index(hash) .
Fact.created_at: dateTime @index(hour) .
Fact.conflicts: [uid] @reverse .

FactConflict.old_fact: uid @reverse .
FactConflict.new_fact: uid @reverse .
FactConflict.similarity: float .
FactConflict.created_at: dateTime .

Episode.agent_id: string @index(hash) .
Episode.content: string @index(fulltext) .
Episode.content_hash: string @index(hash) @upsert .
Episode.source: string @index(hash) .
Episode.ref: string .
Episode.embedding: float32vector @index(hnsw(metric:"cosine")) .
Episode.created_at: dateTime @index(hour) .

Entity.name: string @index(hash, term) .
Entity.entity_type: string @index(hash) .
Entity.properties: string .
Entity.repo: string @index(hash) .
Entity.dedup_key: string @index(hash) @upsert .
Entity.created_at: dateTime .
Entity.updated_at: dateTime @index(hour) .
Entity.out_rels: [uid] @reverse @count .
Entity.in_rels: [uid] @reverse @count .

GraphRel.source: uid @reverse .
GraphRel.target: uid @reverse .
GraphRel.relation_type: string @index(hash) .
GraphRel.properties: string .
GraphRel.valid_from: dateTime @index(hour) .
GraphRel.valid_to: dateTime @index(hour) .
GraphRel.active: bool @index(bool) .
GraphRel.source_episode: uid .
GraphRel.source_memory: uid .
GraphRel.created_at: dateTime .

SharedPool.name: string @index(hash) @upsert .
SharedPool.created_by: string .
SharedPool.created_at: dateTime .

Snapshot.agent_id: string @index(hash) .
Snapshot.memory_refs: string .
Snapshot.trigger: string .
Snapshot.created_at: dateTime .

AuditLog.agent_id: string @index(hash) .
AuditLog.operation: string @index(hash) .
AuditLog.memory_key: string .
AuditLog.metadata: string .
AuditLog.created_at: dateTime @index(hour) .

type Memory {
  Memory.xid
  Memory.agent_id
  Memory.key
  Memory.value
  Memory.embedding
  Memory.version
  Memory.is_deleted
  Memory.pool
  Memory.ttl_seconds
  Memory.expires_at
  Memory.repo
  Memory.retrieval_count
  Memory.last_retrieved_at
  Memory.half_life_days
  Memory.metadata
  Memory.created_at
  Memory.versions
  Memory.facts
}
type MemoryVersion {
  MemoryVersion.xid
  MemoryVersion.memory
  MemoryVersion.version
  MemoryVersion.value
  MemoryVersion.embedding
  MemoryVersion.created_at
}
type Fact {
  Fact.xid
  Fact.text
  Fact.embedding
  Fact.valid_from
  Fact.valid_to
  Fact.active
  Fact.invalidated_by
  Fact.confidence
  Fact.retrieval_count
  Fact.last_retrieved_at
  Fact.half_life_days
  Fact.memory
  Fact.episode
  Fact.agent_id
  Fact.created_at
  Fact.conflicts
}
type FactConflict {
  FactConflict.xid
  FactConflict.old_fact
  FactConflict.new_fact
  FactConflict.similarity
  FactConflict.created_at
}
type Episode {
  Episode.xid
  Episode.agent_id
  Episode.content
  Episode.content_hash
  Episode.source
  Episode.ref
  Episode.embedding
  Episode.created_at
}
type Entity {
  Entity.xid
  Entity.name
  Entity.entity_type
  Entity.properties
  Entity.repo
  Entity.dedup_key
  Entity.created_at
  Entity.updated_at
  Entity.out_rels
  Entity.in_rels
}
type GraphRel {
  GraphRel.xid
  GraphRel.source
  GraphRel.target
  GraphRel.relation_type
  GraphRel.properties
  GraphRel.valid_from
  GraphRel.valid_to
  GraphRel.active
  GraphRel.source_episode
  GraphRel.source_memory
  GraphRel.created_at
}
type SharedPool {
  SharedPool.xid
  SharedPool.name
  SharedPool.created_by
  SharedPool.created_at
}
type Snapshot {
  Snapshot.xid
  Snapshot.agent_id
  Snapshot.memory_refs
  Snapshot.trigger
  Snapshot.created_at
}
type AuditLog {
  AuditLog.xid
  AuditLog.agent_id
  AuditLog.operation
  AuditLog.memory_key
  AuditLog.metadata
  AuditLog.created_at
}
DQL
)

log "Applying memory Dgraph schema to ${DGRAPH_HTTP}/alter ..."
RESP="$(curl -fsS -X POST "${DGRAPH_HTTP}/alter" --data-binary "$SCHEMA" 2>/dev/null)" \
  || fail "could not reach Dgraph at ${DGRAPH_HTTP} — is it up? ('npm run dgraph:up' or 'npm run services:up')"

case "$RESP" in
  *'"code":"Success"'*) log "Dgraph memory schema applied (idempotent)." ;;
  *) fail "Dgraph rejected the schema: $RESP" ;;
esac
