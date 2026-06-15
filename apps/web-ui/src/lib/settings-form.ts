// ── General (non-privileged) settings → written directly to the DB ──────────

export function parseSettingsForm(formData: FormData) {
  const selectedRepos = formData.getAll('cross_repo_repos') as string[];
  const updates: Record<string, unknown> = {
    task_types: (formData.get('task_types') as string || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    auto_review: formData.get('auto_review') === 'yes',
    auto_ingest_graph: formData.get('auto_ingest_graph') === 'yes',
    cross_repo: selectedRepos.length > 0,
    cross_repo_repos: selectedRepos,
    slack_channel_id: (formData.get('slack_channel_id') as string || '').trim() || undefined,
    dispatch_label: (formData.get('dispatch_label') as string || '').trim() || undefined,
    dispatch_default_type: (formData.get('dispatch_default_type') as string || '').trim() || undefined,
  };

  const trustLevel = formData.get('trust_level') as string;
  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  for (const k of Object.keys(updates)) {
    if (updates[k] === undefined) delete updates[k];
  }

  return updates;
}

// ── Privileged (dark_factory + task_overrides) → gated mcp API ──────────────
//
// Only CHANGED fields are emitted. The two-key gate flags privileged fields by
// presence, so re-sending an unchanged value (e.g. execution.image) would demand
// a CODEOWNERS PR on every save. The save action diffs the form against the
// current resolved settings and sends just the delta. An empty result means "no
// privileged change" → skip the gated call entirely.

export interface PrivilegedPatch {
  dark_factory?: Record<string, unknown>;
  task_overrides?: Record<string, Record<string, unknown>>;
}

/** Resolved-settings shape we diff the form against (only the fields we edit). */
export interface CurrentSettings {
  dark_factory?: {
    enabled?: boolean;
    create_issue?: string;
    review?: string;
    notify?: string[];
    execution?: { image?: string };
    auto_merge?: {
      paths?: string[];
      min_trust?: string;
      require_green_ci?: boolean;
      require_bot_approval?: boolean;
    };
  };
  task_overrides?: Record<string, {
    model?: string;
    timeout_minutes?: number;
    system_prompt_suffix?: string;
    review_required?: boolean;
    execution?: { image?: string };
  }>;
}

const yesNo = (fd: FormData, name: string): boolean => fd.get(name) === 'yes';
const text = (fd: FormData, name: string): string =>
  (fd.get(name) as string || '').trim();
const sameArray = (a: string[] = [], b: string[] = []): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function parsePrivilegedChanges(
  formData: FormData,
  current: CurrentSettings,
  knownTaskTypes: string[],
): PrivilegedPatch {
  const patch: PrivilegedPatch = {};
  const df = current.dark_factory ?? {};
  const am = df.auto_merge ?? {};

  const dfChanges: Record<string, unknown> = {};
  if (formData.has('df_enabled')) {
    const enabled = yesNo(formData, 'df_enabled');
    if (enabled !== (df.enabled ?? false)) dfChanges.enabled = enabled;
  }

  const createIssue = text(formData, 'df_create_issue');
  if (createIssue && createIssue !== df.create_issue) dfChanges.create_issue = createIssue;

  const review = text(formData, 'df_review');
  if (review && review !== df.review) dfChanges.review = review;

  if (formData.has('df_notify')) {
    const notify = formData.getAll('df_notify') as string[];
    if (!sameArray(notify, df.notify ?? [])) dfChanges.notify = notify;
  }

  const image = text(formData, 'df_execution_image');
  if (image && image !== (df.execution?.image ?? '')) {
    dfChanges.execution = { image };
  }

  const amChanges: Record<string, unknown> = {};
  if (formData.has('df_am_paths')) {
    const paths = text(formData, 'df_am_paths')
      .split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    if (!sameArray(paths, am.paths ?? [])) amChanges.paths = paths;
  }
  const minTrust = text(formData, 'df_am_min_trust');
  if (minTrust && minTrust !== am.min_trust) amChanges.min_trust = minTrust;
  if (formData.has('df_am_green_ci')) {
    const greenCi = yesNo(formData, 'df_am_green_ci');
    if (greenCi !== (am.require_green_ci ?? true)) amChanges.require_green_ci = greenCi;
  }
  if (formData.has('df_am_bot_approval')) {
    const botApproval = yesNo(formData, 'df_am_bot_approval');
    if (botApproval !== (am.require_bot_approval ?? true)) amChanges.require_bot_approval = botApproval;
  }
  if (Object.keys(amChanges).length > 0) dfChanges.auto_merge = amChanges;

  if (Object.keys(dfChanges).length > 0) patch.dark_factory = dfChanges;

  // Per-task-type overrides — one row per known task type.
  const toChanges: Record<string, Record<string, unknown>> = {};
  for (const type of knownTaskTypes) {
    const prev = current.task_overrides?.[type] ?? {};
    const row: Record<string, unknown> = {};

    const model = text(formData, `to_${type}_model`);
    if (model && model !== (prev.model ?? '')) row.model = model;

    const timeoutRaw = text(formData, `to_${type}_timeout`);
    const timeout = timeoutRaw ? Number(timeoutRaw) : undefined;
    if (timeout !== undefined && timeout !== prev.timeout_minutes) row.timeout_minutes = timeout;

    const suffix = text(formData, `to_${type}_suffix`);
    if (suffix && suffix !== (prev.system_prompt_suffix ?? '')) row.system_prompt_suffix = suffix;

    const toImage = text(formData, `to_${type}_image`);
    if (toImage && toImage !== (prev.execution?.image ?? '')) row.execution = { image: toImage };

    if (Object.keys(row).length > 0) toChanges[type] = row;
  }
  if (Object.keys(toChanges).length > 0) patch.task_overrides = toChanges;

  return patch;
}
