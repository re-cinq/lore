import {
  type AgentDefinition,
  type AgentDefsReadPort,
} from "./agent-defs-port.js";
import { bearerJsonHeaders } from "../lib/http-auth.js";

// AgentDefsReadPort over Lore HTTP API — RUNNER/Station adapter for pods without Postgres access (NetworkPolicy).

export class AgentDefsHttp implements AgentDefsReadPort {
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

    return Array.isArray(body) ? body : (body.agents ?? []);
  }
}
