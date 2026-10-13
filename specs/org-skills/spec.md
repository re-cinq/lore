# Feature Specification: Shared organisation skills

| Feature | Shared organisation skills  |
| ------- | --------------------------- |
| Branch  | org-skills                  |
| Status  | Draft                       |
| Created | 2026-10-13                  |
| Owner   | Platform Engineering        |

Org-managed skills are dynamic, database-backed, and automatically distributed to local developer machines by the local MCP server, replacing the static `apps/mcp-server/agent-skills/` directory as the source of truth for org-wide Claude Code skills.

## Problem Statement

Currently, skills are baked statically into `apps/mcp-server/agent-skills/` and distributed via local setup scripts or the HTTP gateway. We need to move this to a dynamic, database-backed system managed from the Lore web UI, enabling automatic updates to active developer environments without manual re-installation.

## Requirements

### Functional Requirements

- **FR-001**: The system persists dynamic organisation skills in a database-backed system (`lore.skill_definitions` table).
- **FR-002**: The web UI provides an organisation section similar to "Agents" to manage these skill definitions.
- **FR-003**: Skill definitions offer options for setting models, titles, and any other options available in Claude skills.
- **FR-004**: The local MCP server automatically installs and updates these skills on local developers' machines.

## Success Criteria

<!-- Pod for KPIs will fold in success criteria here -->

## Open Questions

<!-- Pod for questions will fold in open questions here -->
