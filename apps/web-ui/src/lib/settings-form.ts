// ── General (non-privileged) settings → written directly to the DB ──────────

export function parseSettingsForm(formData: FormData) {
  const selectedRepos = formData.getAll("cross_repo_repos") as string[];
  const updates: Record<string, unknown> = {
    task_types: commaList(formData, "task_types"),
    auto_review: formData.get("auto_review") === "yes",
    cross_repo: selectedRepos.length > 0,
    cross_repo_repos: selectedRepos,
    slack_channel_id: optionalText(formData, "slack_channel_id"),
    dispatch_label: optionalText(formData, "dispatch_label"),
    dispatch_default_type: optionalText(formData, "dispatch_default_type"),
  };

  const trustLevel = formData.get("trust_level") as string;

  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  return withoutUndefined(updates);
}

/** A comma-separated field as its non-empty, trimmed parts. */
function commaList(formData: FormData, name: string): string[] {
  return ((formData.get(name) as string) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A text field, or undefined when blank — the caller drops undefined rather than writing an empty string. */
function optionalText(formData: FormData, name: string): string | undefined {
  return ((formData.get(name) as string) || "").trim() || undefined;
}

/** Drop the keys that came back undefined, so a blank field leaves the stored value alone. */
function withoutUndefined(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(updates)) {
    if (updates[key] === undefined) {
      delete updates[key];
    }
  }

  return updates;
}

// Privileged settings (dark_factory + task_overrides) → gated mcp API; only changed fields emitted.

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
  task_overrides?: Record<
    string,
    {
      model?: string;
      timeout_minutes?: number;
      system_prompt_suffix?: string;
      review_required?: boolean;
      execution?: { image?: string };
    }
  >;
}

const yesNo = (fd: FormData, name: string): boolean => fd.get(name) === "yes";
const text = (fd: FormData, name: string): string =>
  ((fd.get(name) as string) || "").trim();
const sameArray = (a: string[] = [], b: string[] = []): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Attach a nested block only when something inside it changed — an empty block would read as "clear these settings". */
function attachIfAny(
  into: Record<string, unknown>,
  key: string,
  changes: Record<string, unknown>,
): void {
  if (Object.keys(changes).length > 0) {
    into[key] = changes;
  }
}

/** Record a text field only when it was filled in AND differs from what is stored — an empty box means "leave it alone", not "clear it". */
function recordText(
  into: Record<string, unknown>,
  key: string,
  value: string,
  stored: string | undefined,
): void {
  if (value && value !== (stored ?? "")) {
    into[key] = value;
  }
}

/** Record a field the form always submits (a checkbox or a multi-select) only when it was present AND differs. Presence is the guard: an absent field is a form that never rendered the control, not a cleared value. */
function recordPresent<T>(
  into: Record<string, unknown>,
  key: string,
  present: boolean,
  value: T,
  stored: T,
): void {
  if (present && value !== stored) {
    into[key] = value;
  }
}

function darkFactoryChanges(
  formData: FormData,
  df: NonNullable<CurrentSettings["dark_factory"]>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};

  recordPresent(
    changes,
    "enabled",
    formData.has("df_enabled"),
    yesNo(formData, "df_enabled"),
    df.enabled ?? false,
  );
  recordText(
    changes,
    "create_issue",
    text(formData, "df_create_issue"),
    df.create_issue,
  );
  recordText(changes, "review", text(formData, "df_review"), df.review);

  const notify = formData.getAll("df_notify") as string[];

  if (formData.has("df_notify") && !sameArray(notify, df.notify ?? [])) {
    changes.notify = notify;
  }

  attachIfAny(
    changes,
    "execution",
    executionChanges(formData, df.execution?.image),
  );

  return changes;
}

/** The BYO-container override, which is one field today and a block tomorrow. */
function executionChanges(
  formData: FormData,
  storedImage: string | undefined,
): Record<string, unknown> {
  const execution: Record<string, unknown> = {};

  recordText(
    execution,
    "image",
    text(formData, "df_execution_image"),
    storedImage,
  );

  return execution;
}

function autoMergeChanges(
  formData: FormData,
  am: NonNullable<NonNullable<CurrentSettings["dark_factory"]>["auto_merge"]>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};

  const paths = text(formData, "df_am_paths")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (formData.has("df_am_paths") && !sameArray(paths, am.paths ?? [])) {
    changes.paths = paths;
  }
  recordText(
    changes,
    "min_trust",
    text(formData, "df_am_min_trust"),
    am.min_trust,
  );
  recordPresent(
    changes,
    "require_green_ci",
    formData.has("df_am_green_ci"),
    yesNo(formData, "df_am_green_ci"),
    am.require_green_ci ?? true,
  );
  recordPresent(
    changes,
    "require_bot_approval",
    formData.has("df_am_bot_approval"),
    yesNo(formData, "df_am_bot_approval"),
    am.require_bot_approval ?? true,
  );

  return changes;
}

/** One task type's overrides; empty when the form changed nothing for it. */
function taskOverrideRow(
  formData: FormData,
  type: string,
  prev: NonNullable<CurrentSettings["task_overrides"]>[string],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  recordText(row, "model", text(formData, `to_${type}_model`), prev.model);

  const timeoutRaw = text(formData, `to_${type}_timeout`);
  const timeout = timeoutRaw ? Number(timeoutRaw) : undefined;

  if (timeout !== undefined && timeout !== prev.timeout_minutes) {
    row.timeout_minutes = timeout;
  }
  recordText(
    row,
    "system_prompt_suffix",
    text(formData, `to_${type}_suffix`),
    prev.system_prompt_suffix,
  );

  attachIfAny(
    row,
    "execution",
    executionImage(text(formData, `to_${type}_image`), prev.execution?.image),
  );

  return row;
}

/** The one-field execution block for a task-type override. */
function executionImage(
  image: string,
  stored: string | undefined,
): Record<string, unknown> {
  const execution: Record<string, unknown> = {};

  recordText(execution, "image", image, stored);

  return execution;
}

export function parsePrivilegedChanges(
  formData: FormData,
  current: CurrentSettings,
  knownTaskTypes: string[],
): PrivilegedPatch {
  const patch: PrivilegedPatch = {};
  const df = current.dark_factory ?? {};
  const dfChanges = darkFactoryChanges(formData, df);

  attachIfAny(
    dfChanges,
    "auto_merge",
    autoMergeChanges(formData, df.auto_merge ?? {}),
  );
  attachIfAny(patch as Record<string, unknown>, "dark_factory", dfChanges);
  attachIfAny(
    patch as Record<string, unknown>,
    "task_overrides",
    taskOverrideChanges(formData, current, knownTaskTypes),
  );

  return patch;
}

/** One row per known task type; a type the form left untouched contributes nothing. */
function taskOverrideChanges(
  formData: FormData,
  current: CurrentSettings,
  knownTaskTypes: string[],
): Record<string, Record<string, unknown>> {
  const changes: Record<string, Record<string, unknown>> = {};

  for (const type of knownTaskTypes) {
    const row = taskOverrideRow(
      formData,
      type,
      current.task_overrides?.[type] ?? {},
    );

    attachIfAny(changes, type, row);
  }

  return changes;
}
