import { describe, it, expect } from "vitest";
import { catalogChartYaml, type AgentCatalogConfig } from "./agent-catalog.js";

// Kept out of agent-catalog.test.ts so inserting it does not drift that file's
// dense spec-link anchors (the repo's new-seam-test-in-a-new-file convention).
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
