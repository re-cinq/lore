// Group related pipeline tasks into "assembly lines" (ADR-024 ubiquitous
// language — what GitLab calls a pipeline). An assembly line is the chain of
// tasks that produce one PR: the implementation task, its autonomous-review
// task, and any revision/retry tasks. Pure — the page does the DB read, this
// shapes the rows into runs. Mirrors src/lib/decomposition-view.ts in spirit.

export interface AssemblyLineTaskRow {
  id: string;
  description: string;
  task_type: string;
  status: string;
  priority: string;
  target_repo: string;
  agent_id: string | null;
  pr_url: string | null;
  pr_number: number | null;
  target_branch: string | null;
  /** context_bundle->>'parent_task_id' — set on review / revision children. */
  parent_task_id: string | null;
  /** context_bundle->>'retry_of' — set on infra retries. */
  retry_of: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Per-task LLM cost; only populated by the repo-scoped view's cost column. */
  cost_usd?: number;
}

export type AssemblyLineStatus =
  | 'running'
  | 'failed'
  | 'needs-human'
  | 'merged'
  | 'review'
  | 'pr-created'
  | 'pending';

export interface AssemblyLine {
  /** Stable identity (the lead member's id) — React key + collapse state. */
  runKey: string;
  members: AssemblyLineTaskRow[];
  lead: AssemblyLineTaskRow;
  prNumber: number | null;
  prUrl: string | null;
  targetRepo: string;
  status: AssemblyLineStatus;
  startedAt: string;
  updatedAt: string;
}

const SHARED_TRUNKS = new Set(['', 'main', 'master', 'develop']);

export function isSharedTrunk(branch: string): boolean {
  return SHARED_TRUNKS.has(branch.trim().toLowerCase());
}

// First match wins. An in-flight member outranks a finished one (GitLab: a
// pipeline with any running job reads as running).
const STATUS_RULES: { match: (s: string) => boolean; result: AssemblyLineStatus }[] = [
  { match: (s) => ['running', 'running-local', 'queued', 'pending', 'revision-requested'].includes(s), result: 'running' },
  { match: (s) => ['failed', 'cancelled'].includes(s), result: 'failed' },
  { match: (s) => s === 'needs-human-help', result: 'needs-human' },
  { match: (s) => s === 'merged', result: 'merged' },
  { match: (s) => s === 'review', result: 'review' },
  { match: (s) => ['pr-created', 'completed'].includes(s), result: 'pr-created' },
];

export function deriveAssemblyLineStatus(members: AssemblyLineTaskRow[]): AssemblyLineStatus {
  const all = members.map((m) => m.status);
  for (const rule of STATUS_RULES) {
    if (all.some(rule.match)) return rule.result;
  }
  return 'pending';
}

const ms = (iso: string): number => new Date(iso).getTime();

export function groupTasksIntoAssemblyLines(tasks: AssemblyLineTaskRow[]): AssemblyLine[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parent = new Map(tasks.map((t) => [t.id, t.id]));

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const t of tasks) {
    if (t.parent_task_id && byId.has(t.parent_task_id)) union(t.id, t.parent_task_id);
    if (t.retry_of && byId.has(t.retry_of)) union(t.id, t.retry_of);
  }
  unionByKey(tasks, union, (t) => (t.pr_number != null ? `${t.target_repo}#${t.pr_number}` : null));
  unionByKey(tasks, union, (t) =>
    t.target_branch && !isSharedTrunk(t.target_branch) ? `${t.target_repo}::${t.target_branch}` : null,
  );

  const components = new Map<string, AssemblyLineTaskRow[]>();
  for (const t of tasks) {
    const root = find(t.id);
    const list = components.get(root);
    if (list) list.push(t);
    else components.set(root, [t]);
  }

  return [...components.values()]
    .map((members) => {
      const sorted = [...members].sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id));
      const lead = sorted[0];
      const latest = sorted.reduce((acc, m) => (ms(m.updated_at) > ms(acc.updated_at) ? m : acc), sorted[0]);
      return {
        runKey: lead.id,
        members: sorted,
        lead,
        prNumber: sorted.find((m) => m.pr_number != null)?.pr_number ?? null,
        prUrl: sorted.find((m) => m.pr_url)?.pr_url ?? null,
        targetRepo: lead.target_repo,
        status: deriveAssemblyLineStatus(sorted),
        startedAt: lead.created_at,
        updatedAt: latest.updated_at,
      };
    })
    .sort((a, b) => ms(b.lead.created_at) - ms(a.lead.created_at) || a.runKey.localeCompare(b.runKey));
}

function unionByKey(
  tasks: AssemblyLineTaskRow[],
  union: (a: string, b: string) => void,
  keyOf: (t: AssemblyLineTaskRow) => string | null,
): void {
  const groups = new Map<string, string>();
  for (const t of tasks) {
    const key = keyOf(t);
    if (!key) continue;
    const seed = groups.get(key);
    if (seed) union(seed, t.id);
    else groups.set(key, t.id);
  }
}

export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'running' | 'muted';

const STATUS_VISUALS: Record<AssemblyLineStatus, { label: string; tone: StatusTone }> = {
  merged: { label: 'Merged', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  running: { label: 'Running', tone: 'running' },
  'needs-human': { label: 'Needs human', tone: 'warning' },
  review: { label: 'In review', tone: 'info' },
  'pr-created': { label: 'PR created', tone: 'info' },
  pending: { label: 'Pending', tone: 'muted' },
};

export function statusVisual(status: AssemblyLineStatus): { label: string; tone: StatusTone } {
  return STATUS_VISUALS[status];
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatDuration(startIso: string, endIso: string): string {
  const secs = Math.max(0, Math.round((ms(endIso) - ms(startIso)) / 1000));
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}

const RELATIVE_UNITS: { secs: number; name: string }[] = [
  { secs: 31_536_000, name: 'year' },
  { secs: 2_592_000, name: 'month' },
  { secs: 86_400, name: 'day' },
  { secs: 3_600, name: 'hour' },
  { secs: 60, name: 'minute' },
];

export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const secs = Math.floor((nowMs - ms(iso)) / 1000);
  for (const unit of RELATIVE_UNITS) {
    const value = Math.floor(secs / unit.secs);
    if (value >= 1) return `${value} ${unit.name}${value === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
