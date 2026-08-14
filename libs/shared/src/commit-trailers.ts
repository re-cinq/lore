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
/** The PRE-RENAME key, still READ and never written. Trailers live in git history,
 *  which cannot be rewritten, so every commit Lore has ever authored carries this
 *  spelling forever — the reader accepts both permanently, unlike the event-name
 *  and CR-label shims, which have a deletion condition. */
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

/**
 * Parse the trailer block from a commit message body. Trailers are the
 * last paragraph of the message — a contiguous block of `Key: value`
 * lines preceded by a blank line (or starting at the top).
 *
 * Returns null when:
 *  - the message has no trailer-shaped paragraph,
 *  - the last paragraph mixes trailer and non-trailer lines,
 *  - a required key (Lore-Stage, Lore-Iteration) is missing — Lore-Task is
 *    optional, since task-less lines (code-review) commit without one,
 *  - Lore-Iteration is not a valid integer.
 */
export function parseTrailers(message: string): Trailers | null {
  const normalized = message.replace(/\r\n/g, "\n").trimEnd();

  if (!normalized) {
    return null;
  }

  const paragraphs = normalized.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1];

  const lines = last
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const map = new Map<string, string>();

  for (const line of lines) {
    const m = line.match(TRAILER_LINE_RE);

    if (!m) {
      return null;
    }
    map.set(m[1], m[2]);
  }

  for (const k of REQUIRED_KEYS) {
    if (!map.has(k)) {
      return null;
    }
  }

  const iteration = Number.parseInt(map.get(ITERATION_KEY)!, 10);

  if (!Number.isFinite(iteration)) {
    return null;
  }

  const extras: Record<string, string> = {};

  for (const [k, v] of map.entries()) {
    if (!(FIRST_CLASS_KEYS as readonly string[]).includes(k)) {
      extras[k] = v;
    }
  }

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

/**
 * A single generation-time provenance link extracted from a commit message,
 * declaring that a test target validates one numbered spec statement.
 */
export interface ProvenanceRef {
  specPath: string;
  ordinal: number;
  target: string;
}

/**
 * Render a single provenance link as a `Lore-Validates` commit-trailer line,
 * with the grammar `Lore-Validates: <specPath>#<ordinal> -> <target>`. Inverse
 * of `parseValidatesTrailers`: feeding this output back through the parser
 * yields the original `ProvenanceRef`.
 */
export function formatValidatesTrailer(ref: ProvenanceRef): string {
  return `${VALIDATES_KEY}: ${ref.specPath}#${ref.ordinal} -> ${ref.target}`;
}

/**
 * Extract every `Lore-Validates` provenance link from a commit message.
 *
 * Each match has the grammar `Lore-Validates: <specPath>#<ordinal> -> <target>`,
 * where `ordinal` is the 1-based number of the spec statement and `target` is
 * the validating test reference. Unlike `parseTrailers`, these lines are scanned
 * anywhere in the message (CRLF-normalized) rather than only in the trailing
 * paragraph, and a message may carry many of them. Non-matching lines are
 * ignored; an empty result means no provenance was declared.
 */
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
