import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

interface DelegateContext {
  beads_task_id?: string;
  spec_file?: boolean;
  branch?: string;
  seed_query?: string;
}

export async function buildContextBundle(context?: DelegateContext): Promise<string> {
  const parts: string[] = [];

  if (context?.beads_task_id) {
    try {
      const task = execSync(`bd show ${context.beads_task_id}`, { encoding: 'utf8' });
      parts.push(`## Beads task\n${task}`);
    } catch { /* bd not available, skip */ }
  }

  if (context?.spec_file) {
    for (const file of ['.specify/spec.md', '.specify/constitution.md']) {
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf8');
        const label = file.includes('spec') ? 'Spec' : 'Constitution';
        parts.push(`## ${label}\n${content}`);
      }
    }
  }

  if (context?.seed_query) {
    parts.push(`## Seed query\n${context.seed_query}`);
  }

  if (context?.branch) {
    parts.push(`## Branch\n${context.branch}`);
  }

  return parts.join('\n\n---\n\n');
}
