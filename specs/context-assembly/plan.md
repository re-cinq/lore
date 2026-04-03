# Implementation Plan: Context Assembly Templates

| Field   | Value              |
|---------|--------------------|
| Feature | Context Assembly Templates |
| Spec    | [spec.md](spec.md) |
| Status  | Complete           |
| Created | 2026-04-03         |

## Files Changed

| File | Change |
|------|--------|
| `mcp-server/src/context-assembly.ts` | New file. Template loading, parallel source retrieval, token budget allocation, paragraph-boundary truncation. |
| `mcp-server/src/index.ts` | Registered `assemble_context` MCP tool. Added `loadTemplates()` call at startup. |
| `mcp-server/templates/default.yaml` | New. All sources with balanced priorities. |
| `mcp-server/templates/review.yaml` | New. Conventions and ADRs prioritized. |
| `mcp-server/templates/implementation.yaml` | New. Repo context and ADRs first. |
| `mcp-server/templates/research.yaml` | New. Facts and graph prioritized. |
| `mcp-server/Dockerfile` | Added `COPY templates ./templates` for container builds. |
