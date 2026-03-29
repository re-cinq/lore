/**
 * LLM output parser for onboard tasks.
 *
 * Extracts structured JSON from raw LLM responses using a three-step
 * strategy: direct parse, code-fence extraction, string-aware brace
 * matching. No external dependencies.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface OnboardFiles {
  files: Record<string, string>;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Extract an OnboardFiles object from raw LLM output.
 *
 * Strategy (first success wins):
 *  1. Direct JSON.parse of the entire string
 *  2. Extract the LAST ```json code fence and parse it
 *  3. String-aware brace matching around the `"files"` key
 *
 * Returns null if all strategies fail.
 */
export function extractOnboardFiles(raw: string): OnboardFiles | null {
  // Step 1: Try direct parse
  try {
    const parsed = JSON.parse(raw);
    if (isOnboardFiles(parsed)) return parsed;
  } catch {
    // not valid JSON — continue
  }

  // Step 2: Try last ```json fence
  const fenced = extractLastJsonFence(raw);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced);
      if (isOnboardFiles(parsed)) return parsed;
    } catch {
      // fence content wasn't valid JSON — continue
    }
  }

  // Step 3: String-aware brace matching
  const extracted = extractByBraceMatching(raw);
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted);
      if (isOnboardFiles(parsed)) return parsed;
    } catch {
      // brace-matched substring wasn't valid JSON
    }
  }

  return null;
}

/**
 * Find ALL ```json...``` code fences and return the content of the LAST one.
 *
 * Uses the last match because file contents inside the JSON may themselves
 * contain code fences, so the outermost/final fence is most likely to be
 * the wrapper JSON.
 *
 * Returns null if no fences are found.
 */
export function extractLastJsonFence(text: string): string | null {
  const pattern = /```json\s*\n?([\s\S]*?)```/g;
  let lastMatch: string | null = null;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    lastMatch = m[1];
  }

  return lastMatch;
}

// ── Internals ────────────────────────────────────────────────────────

/** Type guard: object has a `files` property that is a plain object. */
function isOnboardFiles(v: unknown): v is OnboardFiles {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.files !== "object" || obj.files === null) return false;
  if (Array.isArray(obj.files)) return false;
  return true;
}

/**
 * String-aware brace matching.
 *
 * Finds the first `{` that precedes a `"files"` key, then walks forward
 * counting braces while correctly ignoring braces inside JSON string
 * literals (handling escaped quotes).
 *
 * Returns the matched substring or null.
 */
function extractByBraceMatching(raw: string): string | null {
  const filesIdx = raw.indexOf('"files"');
  if (filesIdx === -1) return null;

  // Walk backwards from "files" to find the opening brace
  let startIdx = -1;
  for (let i = filesIdx - 1; i >= 0; i--) {
    if (raw[i] === "{") {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  // Walk forward from the opening brace, tracking depth
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    // Outside a string
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return raw.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}
