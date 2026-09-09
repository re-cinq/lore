import { enforceTrue } from "../../lib/enforce.js";
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

function normalizeStory(raw: unknown): UserStory {
  const title = requiredStoryTitle(raw);
  const s = raw as Record<string, unknown>;
  const tasksRaw = Array.isArray(s.tasks) ? s.tasks : [];

  const story: UserStory = {
    title,
    summary: typeof s.summary === "string" ? s.summary : "",
    acceptance_criteria: asStringList(
      s.acceptance_criteria ?? s.acceptanceCriteria,
    ),
    tasks: tasksRaw.map(normalizeTask),
  };

  applyStoryLabels(story, s);

  return story;
}

function requiredStoryTitle(raw: unknown): string {
  enforceTrue(
    !(!raw || typeof raw !== "object" || Array.isArray(raw)),
    Error,
    "decomposition: each story must be an object",
  );
  const title = storyTitle(raw as Record<string, unknown>);

  enforceTrue(title, Error, "decomposition: each story needs a title");

  return title;
}

function storyTitle(s: Record<string, unknown>): string | false {
  const titleField = typeof s.title === "string" && s.title;
  const nameField = typeof s.name === "string" && s.name;

  return titleField || nameField;
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

function normalizeTaskFromObject(
  t: Record<string, unknown>,
  id: string,
): DecompTask {
  const task: DecompTask = {
    id: taskId(t, id),
    description: requiredTaskDescription(t),
    depends_on: asStringList(t.depends_on ?? t.dependsOn),
    parallelizable: t.parallelizable === true,
    phase: taskPhase(t),
  };

  applyTaskOptionals(task, t);

  return task;
}

function taskId(t: Record<string, unknown>, fallback: string): string {
  return typeof t.id === "string" && t.id ? t.id : fallback;
}

function requiredTaskDescription(t: Record<string, unknown>): string {
  const description = taskDescription(t);

  enforceTrue(
    description,
    Error,
    "decomposition: task description is required",
  );

  return description;
}

function taskDescription(t: Record<string, unknown>): string | false {
  const descriptionField = typeof t.description === "string" && t.description;
  const textField = typeof t.text === "string" && t.text;

  return descriptionField || textField;
}

function taskPhase(t: Record<string, unknown>): number {
  return typeof t.phase === "number" ? t.phase : 0;
}

/** The fields a task may omit entirely — set only when present, because an explicit `undefined` reads back as a declared-but-empty field. */
function applyTaskOptionals(
  task: DecompTask,
  t: Record<string, unknown>,
): void {
  const filePath = taskFilePath(t);

  if (filePath) {
    task.file_path = filePath;
  }
  const labels = asStringList(t.labels);

  if (labels.length) {
    task.labels = labels;
  }
}

function taskFilePath(t: Record<string, unknown>): string | undefined {
  const filePath = t.file_path ?? t.filePath;

  return typeof filePath === "string" && filePath ? filePath : undefined;
}

function applyStoryLabels(story: UserStory, s: Record<string, unknown>): void {
  const labels = asStringList(s.labels);

  if (labels.length) {
    story.labels = labels;
  }
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
