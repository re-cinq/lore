import { enforceTrue } from "../lib/enforce.js";
// Feature spec decomposition into user stories/tasks (ADR-029); lenient parse, pure, no I/O.

export interface DecompTask {
  id: string; // "T001"
  description: string;
  depends_on: string[]; // ["T002"]
  parallelizable: boolean;
  phase: number; // 0 when the agent gives no phase
  file_path?: string;
  /** Agent labels from repo REAL list; validated (see decideIssueWork) to prevent GitHub silent invention. */
  labels?: string[];
}

export interface UserStory {
  title: string;
  summary: string;
  acceptance_criteria: string[];
  tasks: DecompTask[];
  /** Labels for this story's Issue, chosen from the repo's real label list. */
  labels?: string[];
}

export interface DecompositionResult {
  stories: UserStory[];
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((s): s is string => typeof s === "string" && s.length > 0);
  }

  if (typeof v === "string" && v.length > 0) {
    return [v];
  }

  return [];
}

function normalizeTaskFromString(raw: string, id: string): DecompTask {
  enforceTrue(raw.trim(), Error, "decomposition: task description is required");

  return {
    id,
    description: raw,
    depends_on: [],
    parallelizable: false,
    phase: 0,
  };
}

function taskDescription(t: Record<string, unknown>): string | false {
  const descriptionField = typeof t.description === "string" && t.description;
  const textField = typeof t.text === "string" && t.text;

  return descriptionField || textField;
}

function taskFilePath(t: Record<string, unknown>): string | undefined {
  const filePath = t.file_path ?? t.filePath;

  return typeof filePath === "string" && filePath ? filePath : undefined;
}

function taskId(t: Record<string, unknown>, fallback: string): string {
  return typeof t.id === "string" && t.id ? t.id : fallback;
}

function taskPhase(t: Record<string, unknown>): number {
  return typeof t.phase === "number" ? t.phase : 0;
}

function normalizeTaskFromObject(
  t: Record<string, unknown>,
  id: string,
): DecompTask {
  const description = taskDescription(t);

  enforceTrue(
    description,
    Error,
    "decomposition: task description is required",
  );
  const task: DecompTask = {
    id: taskId(t, id),
    description,
    depends_on: asStringList(t.depends_on ?? t.dependsOn),
    parallelizable: t.parallelizable === true,
    phase: taskPhase(t),
  };
  const filePath = taskFilePath(t);

  if (filePath) {
    task.file_path = filePath;
  }
  const labels = asStringList(t.labels);

  if (labels.length) {
    task.labels = labels;
  }

  return task;
}

function normalizeTask(raw: unknown, index: number): DecompTask {
  const id = `T${String(index + 1).padStart(3, "0")}`;

  if (typeof raw === "string") {
    return normalizeTaskFromString(raw, id);
  }
  enforceTrue(
    !(!raw || typeof raw !== "object"),
    Error,
    "decomposition: task must be an object or string",
  );

  return normalizeTaskFromObject(raw as Record<string, unknown>, id);
}

function normalizeStory(raw: unknown): UserStory {
  enforceTrue(
    !(!raw || typeof raw !== "object" || Array.isArray(raw)),
    Error,
    "decomposition: each story must be an object",
  );
  const s = raw as Record<string, unknown>;
  const titleField = typeof s.title === "string" && s.title;
  const nameField = typeof s.name === "string" && s.name;
  const title = titleField || nameField;

  enforceTrue(title, Error, "decomposition: each story needs a title");
  const tasksRaw = Array.isArray(s.tasks) ? s.tasks : [];

  const story: UserStory = {
    title,
    summary: typeof s.summary === "string" ? s.summary : "",
    acceptance_criteria: asStringList(
      s.acceptance_criteria ?? s.acceptanceCriteria,
    ),
    tasks: tasksRaw.map(normalizeTask),
  };
  const labels = asStringList(s.labels);

  if (labels.length) {
    story.labels = labels;
  }

  return story;
}

/** Parse + normalize decomposition; throws on structural failure, tolerates field-name drift. */
export function parseDecomposition(raw: unknown): DecompositionResult {
  enforceTrue(
    !(!raw || typeof raw !== "object" || Array.isArray(raw)),
    Error,
    "decomposition: root must be an object",
  );
  const stories = (raw as Record<string, unknown>).stories;

  enforceTrue(
    Array.isArray(stories),
    Error,
    "decomposition: stories must be an array",
  );

  return { stories: stories.map(normalizeStory) };
}
