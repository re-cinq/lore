import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const AGENT_ID_DIR = join(process.env.HOME || '/tmp', '.lore');
const AGENT_ID_FILE = join(AGENT_ID_DIR, 'agent-id');

export function resolveAgentId(explicit?: string): string {
  // 1. Explicit parameter
  if (explicit) return explicit;

  // 2. Environment variable (Klaus pods set this to pod name)
  if (process.env.LORE_AGENT_ID) return process.env.LORE_AGENT_ID;

  // 3. File-based (~/.lore/agent-id)
  try {
    if (existsSync(AGENT_ID_FILE)) {
      return readFileSync(AGENT_ID_FILE, 'utf-8').trim();
    }
  } catch {}

  // 4. Generate and store
  const id = randomUUID();
  try {
    mkdirSync(AGENT_ID_DIR, { recursive: true });
    writeFileSync(AGENT_ID_FILE, id + '\n');
  } catch {}
  return id;
}
