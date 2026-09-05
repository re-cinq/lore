/** Dgraph implementation of the MemoryStore seam, sibling of PostgresMemoryStore; depends only on the injected DgraphClientPort, never imports the driver. Every method delegates onto a pure-client function grouped by job across the sibling dgraph-{memory-crud,fact-episode,graph-edges,search}.ts modules. */

import type {
  DgraphClientPort,
  MemoryRecord,
  MemoryStore,
  WriteResult,
} from "./memory-store-types.js";
import type { MemorySearchResult } from "./memory-ranking.js";
import type { GraphHop } from "./dgraph-graph-hops.js";
import * as memoryCrud from "./dgraph-memory-crud.js";
import * as factEpisode from "./dgraph-fact-episode.js";
import * as graphEdges from "./dgraph-graph-edges.js";
import { searchMemories } from "./dgraph-search.js";

export type { GraphHop } from "./dgraph-graph-hops.js";

export class DgraphMemoryStore implements MemoryStore {
  readonly backend = "dgraph" as const;

  constructor(private readonly client: DgraphClientPort) {}

  async writeMemory(input: {
    key: string;
    value: string;
    agentId: string;
    ttl?: number;
    embedding?: number[];
    repo?: string;
  }): Promise<WriteResult> {
    return memoryCrud.writeMemory(this.client, input);
  }

  async readMemory(
    key: string,
    agentId: string,
  ): Promise<MemoryRecord | MemoryRecord[] | null> {
    return memoryCrud.readMemory(this.client, key, agentId);
  }

  async deleteMemory(
    key: string,
    agentId: string,
  ): Promise<{ key: string; deleted: boolean }> {
    return memoryCrud.deleteMemory(this.client, key, agentId);
  }

  async listMemories(opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  }): Promise<{ memories: MemoryRecord[]; total: number }> {
    return memoryCrud.listMemories(this.client, opts);
  }

  async persistFact(input: {
    text: string;
    agentId: string;
    embedding?: number[];
    confidence?: string;
  }): Promise<{ id: string }> {
    return factEpisode.persistFact(this.client, input);
  }

  async writeEpisode(input: {
    content: string;
    agentId: string;
    source?: string;
    ref?: string;
    embedding?: number[];
  }): Promise<{ id: string }> {
    return factEpisode.writeEpisode(this.client, input);
  }

  async upsertEdge(input: {
    source: string;
    target: string;
    relationType: string;
    entityType?: string;
    repo?: string;
  }): Promise<void> {
    return graphEdges.upsertEdge(this.client, input);
  }

  async queryGraph(
    entityName: string,
    depth: number,
    _relationType?: string,
  ): Promise<GraphHop[]> {
    return graphEdges.queryGraph(this.client, entityName, depth);
  }

  async searchMemories(
    query: string,
    opts: { agentId?: string; limit?: number; embedding?: number[] },
  ): Promise<MemorySearchResult[]> {
    return searchMemories(this.client, query, opts);
  }
}
