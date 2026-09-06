export interface Trailers {
  stage: string;
  iteration: number;
  taskId: string;
  /** Per-attempt assembly line id — optional: commits from before migration 0025 lack it. */
  assemblyLineId?: string;
  extras?: Record<string, string>;
}

const STAGE_KEY = "Lore-Stage";
const ITERATION_KEY = "Lore-Iteration";
const TASK_KEY = "Lore-Task";
const ASSEMBLY_RUN_KEY = "Lore-Assembly-Run";
// The PRE-RENAME key, still READ and never written — git history can't be rewritten, so this spelling is accepted permanently (unlike the event-name/CR-label shims, which have a deletion condition).
const LEGACY_ASSEMBLY_LINE_KEY = "Lore-Assembly-Line";
const VALIDATES_KEY = "Lore-Validates";
// Lore-Task is NOT required: task-less lines (code-review) commit without one.
const REQUIRED_KEYS = [STAGE_KEY, ITERATION_KEY] as const;
const FIRST_CLASS_KEYS = [
  STAGE_KEY,
  ITERATION_KEY,
  TASK_KEY,
  ASSEMBLY_RUN_KEY,
  LEGACY_ASSEMBLY_LINE_KEY,
] as const;

const TRAILER_LINE_RE = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/;

const VALIDATES_LINE_RE = new RegExp(
  `^${VALIDATES_KEY}:\\s*(.+?)#(\\d+)\\s*->\\s*(.+?)\\s*$`,
);

export function formatTrailers(t: Trailers): string {
  const lines = [
    `${STAGE_KEY}: ${t.stage}`,
    `${ITERATION_KEY}: ${t.iteration}`,
  ];

  if (t.taskId) {
    lines.push(`${TASK_KEY}: ${t.taskId}`);
  }

  if (t.assemblyLineId) {
    lines.push(`${ASSEMBLY_RUN_KEY}: ${t.assemblyLineId}`);
  }

  if (t.extras) {
    for (const [k, v] of Object.entries(t.extras)) {
      lines.push(`${k}: ${v}`);
    }
  }

  return lines.join("\n");
}

function lastTrailerParagraphLines(message: string): string[] {
  const normalized = message.replace(/\r\n/g, "\n").trimEnd();

  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1];

  return last
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function trailerMap(lines: string[]): Map<string, string> | null {
  const map = new Map<string, string>();

  for (const line of lines) {
    const m = line.match(TRAILER_LINE_RE);

    if (!m) {
      return null;
    }
    map.set(m[1], m[2]);
  }

  return map;
}

function hasRequiredKeys(map: Map<string, string>): boolean {
  return REQUIRED_KEYS.every((k) => map.has(k));
}

function extractExtras(map: Map<string, string>): Record<string, string> {
  const extras: Record<string, string> = {};

  for (const [k, v] of map.entries()) {
    if (!(FIRST_CLASS_KEYS as readonly string[]).includes(k)) {
      extras[k] = v;
    }
  }

  return extras;
}

function buildTrailers(map: Map<string, string>, iteration: number): Trailers {
  const extras = extractExtras(map);
  const assemblyLineId =
    map.get(ASSEMBLY_RUN_KEY) ?? map.get(LEGACY_ASSEMBLY_LINE_KEY);

  return {
    stage: map.get(STAGE_KEY)!,
    iteration,
    taskId: map.get(TASK_KEY) ?? "",
    ...(assemblyLineId ? { assemblyLineId } : {}),
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  };
}

// Parses the trailer block (last paragraph, contiguous `Key: value` lines); returns null on no trailer paragraph, mixed lines, a missing required key, or a non-integer Lore-Iteration.
export function parseTrailers(message: string): Trailers | null {
  const lines = lastTrailerParagraphLines(message);

  if (lines.length === 0) {
    return null;
  }

  const map = trailerMap(lines);

  if (!map || !hasRequiredKeys(map)) {
    return null;
  }

  const iteration = Number.parseInt(map.get(ITERATION_KEY)!, 10);

  if (!Number.isFinite(iteration)) {
    return null;
  }

  return buildTrailers(map, iteration);
}

/** A generation-time provenance link declaring that a test target validates one numbered spec statement. */
export interface ProvenanceRef {
  specPath: string;
  ordinal: number;
  target: string;
}

// Renders a provenance link as `Lore-Validates: <specPath>#<ordinal> -> <target>`; inverse of `parseValidatesTrailers`.
export function formatValidatesTrailer(ref: ProvenanceRef): string {
  return `${VALIDATES_KEY}: ${ref.specPath}#${ref.ordinal} -> ${ref.target}`;
}

// Extracts every `Lore-Validates` link from a commit message; unlike parseTrailers, scans the whole message (not just the trailing paragraph) and may return many.
export function parseValidatesTrailers(message: string): ProvenanceRef[] {
  const refs: ProvenanceRef[] = [];

  for (const line of message.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.trim().match(VALIDATES_LINE_RE);

    if (!match) {
      continue;
    }
    refs.push({
      specPath: match[1],
      ordinal: Number.parseInt(match[2], 10),
      target: match[3],
    });
  }

  return refs;
}
