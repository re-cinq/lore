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

/** A checkbox's submitted value, or undefined when the form never rendered the control. */
const checkbox = (fd: FormData, name: string): boolean | undefined =>
  fd.has(name) ? fd.get(name) === "yes" : undefined;
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

/** Record a checkbox only when the form rendered it AND it differs from what is stored — an absent control means the form never offered the field, not that it was cleared. */
function recordCheckbox(
  into: Record<string, unknown>,
  key: string,
  field: { value: boolean | undefined; stored: boolean },
): void {
  if (field.value !== undefined && field.value !== field.stored) {
    into[key] = field.value;
  }
}

type DarkFactorySettings = NonNullable<CurrentSettings["dark_factory"]>;

function recordDarkFactoryScalars(
  changes: Record<string, unknown>,
  formData: FormData,
  df: DarkFactorySettings,
): void {
  recordCheckbox(changes, "enabled", {
    value: checkbox(formData, "df_enabled"),
    stored: df.enabled ?? false,
  });
  recordText(
    changes,
    "create_issue",
    text(formData, "df_create_issue"),
    df.create_issue,
  );
  recordText(changes, "review", text(formData, "df_review"), df.review);
}

/** The notify channel list, recorded only when the form rendered the control AND it differs — absence is not emptiness. */
function recordNotify(
  changes: Record<string, unknown>,
  formData: FormData,
  current: string[],
): void {
  const notify = formData.getAll("df_notify") as string[];

  if (formData.has("df_notify") && !sameArray(notify, current)) {
    changes.notify = notify;
  }
}

function darkFactoryChanges(
  formData: FormData,
  df: DarkFactorySettings,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};

  recordDarkFactoryScalars(changes, formData, df);
  recordNotify(changes, formData, df.notify ?? []);
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

/** The auto-merge allowlist, recorded only when the field was submitted AND differs. Absence is not emptiness: a form that never rendered the field must not read as clearing the allowlist, which would widen what auto-merge is permitted to touch. */
function recordPaths(
  changes: Record<string, unknown>,
  formData: FormData,
  current: string[],
): void {
  const paths = text(formData, "df_am_paths")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (formData.has("df_am_paths") && !sameArray(paths, current)) {
    changes.paths = paths;
  }
}

type AutoMergeSettings = NonNullable<DarkFactorySettings["auto_merge"]>;

/** The two merge gates, whose stored default is on — a form that never rendered them must not turn them off. */
function recordAutoMergeGates(
  changes: Record<string, unknown>,
  formData: FormData,
  am: AutoMergeSettings,
): void {
  recordCheckbox(changes, "require_green_ci", {
    value: checkbox(formData, "df_am_green_ci"),
    stored: am.require_green_ci ?? true,
  });
  recordCheckbox(changes, "require_bot_approval", {
    value: checkbox(formData, "df_am_bot_approval"),
    stored: am.require_bot_approval ?? true,
  });
}

function autoMergeChanges(
  formData: FormData,
  am: AutoMergeSettings,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};

  recordPaths(changes, formData, am.paths ?? []);
  recordText(
    changes,
    "min_trust",
    text(formData, "df_am_min_trust"),
    am.min_trust,
  );
  recordAutoMergeGates(changes, formData, am);

  return changes;
}

/** A timeout counts only when the box holds a number that differs from what is stored. */
function recordTimeout(
  row: Record<string, unknown>,
  raw: string,
  stored: number | undefined,
): void {
  const timeout = raw ? Number(raw) : undefined;

  if (timeout !== undefined && timeout !== stored) {
    row.timeout_minutes = timeout;
  }
}

type TaskOverride = NonNullable<CurrentSettings["task_overrides"]>[string];

/** The scalar fields of one task-type override row. */
function recordTaskOverrideFields(
  row: Record<string, unknown>,
  formData: FormData,
  type: string,
  prev: TaskOverride,
): void {
  recordText(row, "model", text(formData, `to_${type}_model`), prev.model);
  recordTimeout(
    row,
    text(formData, `to_${type}_timeout`),
    prev.timeout_minutes,
  );
  recordText(
    row,
    "system_prompt_suffix",
    text(formData, `to_${type}_suffix`),
    prev.system_prompt_suffix,
  );
}

/** One task type's overrides; empty when the form changed nothing for it. */
function taskOverrideRow(
  formData: FormData,
  type: string,
  prev: TaskOverride,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  recordTaskOverrideFields(row, formData, type, prev);
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

/** The whole dark_factory block, auto_merge nested inside it. */
function darkFactoryPatch(
  formData: FormData,
  current: CurrentSettings,
): Record<string, unknown> {
  const df = current.dark_factory ?? {};
  const dfChanges = darkFactoryChanges(formData, df);

  attachIfAny(
    dfChanges,
    "auto_merge",
    autoMergeChanges(formData, df.auto_merge ?? {}),
  );

  return dfChanges;
}

export function parsePrivilegedChanges(
  formData: FormData,
  current: CurrentSettings,
  knownTaskTypes: string[],
): PrivilegedPatch {
  const patch: PrivilegedPatch = {};

  attachIfAny(
    patch as Record<string, unknown>,
    "dark_factory",
    darkFactoryPatch(formData, current),
  );
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
