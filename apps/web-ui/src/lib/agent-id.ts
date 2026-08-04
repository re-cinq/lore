// Display formatting for agent ids in the UI. NOT a mirror of
// libs/shared/src/agent-id.ts — that module resolves a machine's persistent
// agent identity (env var + ~/.lore file); the shared filename is a
// coincidence and no lockstep is required.

import { shortAgentId } from "./task-presenter";

export function displayAgentId(id: string): string {
  const compact = id.replace(/-/g, "");
  const isOpaqueHash = compact.length >= 16 && /^[0-9a-f]+$/i.test(compact);

  return isOpaqueHash ? shortAgentId(id, 8) : id;
}
