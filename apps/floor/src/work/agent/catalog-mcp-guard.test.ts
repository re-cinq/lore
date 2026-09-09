import { describe, it, expect } from "vitest";
import { catalogChartYaml, type AgentCatalogConfig } from "./agent-catalog.js";

const impl: AgentCatalogConfig = {
  prompt_template: "Implement the spec.\n",
  model: "claude-sonnet-4-6",
};

describe("catalogChartYaml mcp_servers guard", () => {
  it("wraps the mcp_servers block behind loreMcpUrl and templates its url (no sentinel leak)", () => {
    const out = catalogChartYaml({ implementation: impl });

    expect(out).toContain("{{- if .Values.loreMcpUrl }}");
    expect(out).toContain("url: {{ .Values.loreMcpUrl }}");
    expect(out).toContain("{{- end }}");
    expect(out).not.toContain("__LORE_MCP_URL__");
  });
});
