import {
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefsPort,
} from "./agent-defs-port.js";
import { bearerJsonHeaders } from "../lib/http-auth.js";

// AgentDefsPort over Lore HTTP API — RUNNER/Station adapter for pods without Postgres access (NetworkPolicy).

const READ_ONLY =
  "agent definitions are read-only from a runner — edit them via the API or UI";

export class AgentDefsHttp implements AgentDefsPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return bearerJsonHeaders(this.token);
  }

  async resolve(repo: string, name: string): Promise<AgentDefinition | null> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/repos/${repo}/agent-definitions/${encodeURIComponent(name)}`,
      { headers: this.headers() },
    );

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`agentDefs.resolve failed: ${res.status}`);
    }

    return (await res.json()) as AgentDefinition;
  }

  async list(repo: string): Promise<AgentDefinition[]> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/repos/${repo}/agent-definitions`,
      {
        headers: this.headers(),
      },
    );

    if (!res.ok) {
      throw new Error(`agentDefs.list failed: ${res.status}`);
    }
    const body = (await res.json()) as
      { agents?: AgentDefinition[] } | AgentDefinition[];

    // eslint-disable-next-line re-lint/no-duplicate-code -- the HTTP agent-definitions adapter; what it shares with the YAML one is the port's method list, and only one of the two can be the offline fallback
    return Array.isArray(body) ? body : (body.agents ?? []);
  }

  async create(
    _repo: string,
    _def: AgentDefinitionInput,
  ): Promise<AgentDefinition> {
    throw new Error(READ_ONLY);
  }

  async update(
    _repo: string,
    _name: string,
    _patch: Partial<AgentDefinitionInput>,
  ): Promise<AgentDefinition> {
    throw new Error(READ_ONLY);
  }

  async delete(_repo: string, _name: string): Promise<void> {
    throw new Error(READ_ONLY);
  }
}
