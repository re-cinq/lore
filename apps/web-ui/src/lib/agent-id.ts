// Display formatting only — NOT a mirror of libs/shared/src/agent-id.ts (identity resolution); same filename is coincidence.
import { shortAgentId } from "./task-presenter";

export function displayAgentId(id: string): string {
  const compact = id.replace(/-/g, "");
  const isOpaqueHash = compact.length >= 16 && /^[0-9a-f]+$/i.test(compact);

  return isOpaqueHash ? shortAgentId(id, 8) : id;
}
