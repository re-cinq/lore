import type {
  AgentDefinitionBody,
  DefinitionApi,
  DefinitionRowView,
  PutResult,
} from "@re-cinq/floor-client";

export class InMemoryAgentDefinitions implements DefinitionApi<AgentDefinitionBody> {
  readonly rows = new Map<string, DefinitionRowView<AgentDefinitionBody>[]>();

  list(): Promise<DefinitionRowView<AgentDefinitionBody>[]> {
    return Promise.resolve(
      [...this.rows.values()].map((versions) => versions[versions.length - 1]),
    );
  }

  get(id: string): Promise<DefinitionRowView<AgentDefinitionBody> | null> {
    const versions = this.rows.get(id) ?? [];

    return Promise.resolve(versions[versions.length - 1] ?? null);
  }

  versions(id: string): Promise<DefinitionRowView<AgentDefinitionBody>[]> {
    return Promise.resolve(this.rows.get(id) ?? []);
  }

  version(): Promise<DefinitionRowView<AgentDefinitionBody> | null> {
    return Promise.resolve(null);
  }

  put(id: string, body: AgentDefinitionBody): Promise<PutResult> {
    const versions = this.rows.get(id) ?? [];
    const hash = `v${versions.length + 1}`;

    this.rows.set(id, [...versions, this.stored(id, hash, body)]);

    return Promise.resolve({ hash, created: true });
  }

  archive(id: string): Promise<void> {
    this.rows.delete(id);

    return Promise.resolve();
  }

  protected stored(
    id: string,
    hash: string,
    body: AgentDefinitionBody,
  ): DefinitionRowView<AgentDefinitionBody> {
    return {
      kind: "agent_definition",
      id,
      hash,
      body: structuredClone(body),
      archivedAt: null,
      createdBy: null,
      createdAt: "2026-10-31T00:00:00Z",
    };
  }
}
