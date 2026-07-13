// The decomposition of a finalized feature spec into an implementable tree:
// user stories, each with its tasks. Produced by the `feature-decompose` agent
// (ADR-029) and parsed leniently — the same drift tolerance as GapResult — so
// model variance never hard-fails a round. Pure; no I/O.

export interface DecompTask {
  id: string; // "T001"
  description: string;
  depends_on: string[]; // ["T002"]
  parallelizable: boolean;
  phase: number; // 0 when the agent gives no phase
  file_path?: string;
}

export interface UserStory {
  title: string;
  summary: string;
  acceptance_criteria: string[];
  tasks: DecompTask[];
}

export interface DecompositionResult {
  stories: UserStory[];
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

function normalizeTask(raw: unknown, index: number): DecompTask {
  const id = `T${String(index + 1).padStart(3, "0")}`;
  if (typeof raw === "string") {
    if (!raw.trim())
      throw new Error("decomposition: task description is required");
    return {
      id,
      description: raw,
      depends_on: [],
      parallelizable: false,
      phase: 0,
    };
  }
  if (!raw || typeof raw !== "object")
    throw new Error("decomposition: task must be an object or string");
  const t = raw as Record<string, unknown>;
  const description =
    (typeof t.description === "string" && t.description) ||
    (typeof t.text === "string" && t.text);
  if (!description)
    throw new Error("decomposition: task description is required");
  const task: DecompTask = {
    id: typeof t.id === "string" && t.id ? t.id : id,
    description,
    depends_on: asStringList(t.depends_on ?? t.dependsOn),
    parallelizable: t.parallelizable === true,
    phase: typeof t.phase === "number" ? t.phase : 0,
  };
  const filePath = t.file_path ?? t.filePath;
  if (typeof filePath === "string" && filePath) task.file_path = filePath;
  return task;
}

function normalizeStory(raw: unknown): UserStory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("decomposition: each story must be an object");
  }
  const s = raw as Record<string, unknown>;
  const title =
    (typeof s.title === "string" && s.title) ||
    (typeof s.name === "string" && s.name);
  if (!title) throw new Error("decomposition: each story needs a title");
  const tasksRaw = Array.isArray(s.tasks) ? s.tasks : [];
  return {
    title,
    summary: typeof s.summary === "string" ? s.summary : "",
    acceptance_criteria: asStringList(
      s.acceptance_criteria ?? s.acceptanceCriteria,
    ),
    tasks: tasksRaw.map(normalizeTask),
  };
}

/** Parse + normalize an agent's raw decomposition into the canonical shape.
 *  Throws on structural failure (no object root, no stories array, a titleless
 *  story, or a task with no description); tolerates field-name drift otherwise. */
export function parseDecomposition(raw: unknown): DecompositionResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("decomposition: root must be an object");
  }
  const stories = (raw as Record<string, unknown>).stories;
  if (!Array.isArray(stories))
    throw new Error("decomposition: stories must be an array");
  return { stories: stories.map(normalizeStory) };
}
