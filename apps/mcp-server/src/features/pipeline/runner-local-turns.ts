// Turn ingest: relays the run's stream-json transcript to the Floor's turn store via lore-api POST /api/task-turns/{taskId}, redacted per line before anything leaves the machine (#1295).
import * as fs from "node:fs";
import { redactSecrets } from "@re-cinq/lore-shared";
import {
  type LocalTask,
  getApiUrl,
  getToken,
  warnBestEffort,
} from "./runner-local-storage.js";

// Use shared redaction (alias for backward compatibility)
const redactLogs = redactSecrets;

// Sibling file capturing stderr, kept out of the NDJSON transcript so a stderr write can never land mid-JSON-line.
export function errFileFor(logFile: string): string {
  return `${logFile}.err`;
}

function parsesAsJson(line: string): boolean {
  try {
    JSON.parse(line);

    return true;
  } catch {
    return false;
  }
}

/** A blank or non-JSON raw line carries nothing worth redacting or relaying. */
function isUsableRawLine(line: string): boolean {
  return line.length > 0 && parsesAsJson(line);
}

/** True when redaction left the line intact, or still valid JSON despite the edits. */
function redactedLineIsUsable(redacted: string, original: string): boolean {
  return redacted === original || parsesAsJson(redacted);
}

// Redacts per line (matching the Floor's rule — a whole-text pass could span JSON boundaries and erase lines in between); a line whose JSON breaks under redaction is counted in `dropped`.
export function buildTurnLines(
  rawLog: string,
  redact: (text: string) => string = redactLogs,
): { lines: string[]; dropped: number } {
  const lines: string[] = [];
  let dropped = 0;

  for (const raw of rawLog.split("\n")) {
    const line = raw.trim();

    if (!isUsableRawLine(line)) {
      continue;
    }

    const redacted = redact(line);

    if (redactedLineIsUsable(redacted, line)) {
      lines.push(redacted);
      continue;
    }
    dropped++;
  }

  return { lines, dropped };
}

// Greedy batches under both relay caps (bytes and line count) — lore-api's body limit is 1MB, so the caller passes ~700KB headroom.
export function batchTurnLines(
  lines: string[],
  maxBytes: number,
  maxLines: number,
): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchBytes = 0;

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;

    if (
      batch.length > 0 &&
      (batch.length >= maxLines || batchBytes + lineBytes > maxBytes)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(line);
    batchBytes += lineBytes;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

const TURN_BATCH_MAX_BYTES = 700 * 1024;
const TURN_BATCH_MAX_LINES = 2000;

// A line whose own bytes exceed the batch cap can never relay (lore-api would 413 the whole request), so it's dropped loudly here instead of costing the batches behind it.
export function dropOversizedTurnLines(
  lines: string[],
  maxBytes: number,
): { kept: string[]; oversized: number } {
  const kept = lines.filter(
    (line) => Buffer.byteLength(line, "utf8") + 1 <= maxBytes,
  );

  return { kept, oversized: lines.length - kept.length };
}

/** The lines worth relaying, with both ways a line is lost reported: redaction left it unparseable, or the line alone exceeds the relay cap. */
function turnLinesToRelay(task: LocalTask, rawLogs: string): string[] {
  const { lines, dropped } = buildTurnLines(rawLogs);

  if (dropped > 0) {
    console.warn(
      `[lore] local-runner: ${dropped} turn line(s) dropped for ${task.taskId}: redaction left the line unparseable`,
    );
  }
  const { kept, oversized } = dropOversizedTurnLines(
    lines,
    TURN_BATCH_MAX_BYTES,
  );

  if (oversized > 0) {
    console.warn(
      `[lore] local-runner: ${oversized} turn line(s) dropped for ${task.taskId}: line exceeds the ${TURN_BATCH_MAX_BYTES}-byte relay cap`,
    );
  }

  return kept;
}

async function postTurnBatch(
  relay: { apiUrl: string; token: string; task: LocalTask },
  batch: string[],
  offset: number,
): Promise<boolean> {
  const { apiUrl, token, task } = relay;

  try {
    const resp = await fetch(`${apiUrl}/api/task-turns/${task.taskId}`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-ndjson",
        "x-turn-offset": String(offset),
      },
      body: batch.join("\n"),
    });

    if (!resp.ok) {
      throw new Error(
        `turn ingest returned ${resp.status} for task ${task.taskId}`,
      );
    }

    return true;
  } catch (err) {
    warnBestEffort(
      `turn batch (${batch.length} lines) for task ${task.taskId}`,
      err,
    );

    return false;
  }
}

// Exported for tests (the x-turn-offset accounting); production callers stay inside this module via persistRunArtifacts.
export async function ingestTurns(
  task: LocalTask,
  rawLogs: string,
): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!apiUrl || !token) {
    return;
  }
  const kept = turnLinesToRelay(task, rawLogs);
  // A failed batch is counted and skipped, never aborting — the terminal result line rides last, so stopping early would cost the whole transcript tail.
  let failed = 0;
  // Each batch declares its cumulative start offset so the relay can key lines by position and dedup a re-POST (#1389); advanced on failure too.
  let offset = 0;

  for (const batch of batchTurnLines(
    kept,
    TURN_BATCH_MAX_BYTES,
    TURN_BATCH_MAX_LINES,
  )) {
    const posted = await postTurnBatch({ apiUrl, token, task }, batch, offset);

    offset += batch.length;
    failed += posted ? 0 : 1;
  }

  if (failed > 0) {
    console.warn(
      `[lore] local-runner: ${failed} turn batch(es) failed for ${task.taskId}`,
    );
  }
}

/** stderr is appended as a trailing block, not interleaved with stdout — chronology across the two streams is lost in the GCS copy. */
async function uploadLogs(task: LocalTask, rawLogs: string): Promise<void> {
  const errFile = errFileFor(task.logFile);
  const stderr = fs.existsSync(errFile)
    ? fs.readFileSync(errFile, "utf-8").trim()
    : "";
  const combined = stderr ? `${rawLogs}\n--- STDERR ---\n${stderr}\n` : rawLogs;
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!apiUrl || !token) {
    return;
  }
  await fetch(`${apiUrl}/api/task-logs`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task_id: task.taskId,
      repo: task.repo,
      logs: redactLogs(combined),
    }),
  });
}

// Best-effort persistence of the run's artifacts (redacted log to GCS + redacted transcript to the Floor's turn store); called on EVERY monitorTask exit path, including needs-human-help, since failed runs matter most.
export async function persistRunArtifacts(task: LocalTask): Promise<void> {
  let rawLogs = "";

  try {
    rawLogs = fs.readFileSync(task.logFile, "utf-8");
    await uploadLogs(task, rawLogs);
  } catch (err) {
    warnBestEffort(
      `log upload for task ${task.taskId} (logs kept locally)`,
      err,
    );
  }

  try {
    await ingestTurns(task, rawLogs);
  } catch (err) {
    warnBestEffort(
      `turn ingest for task ${task.taskId} (transcript kept locally)`,
      err,
    );
  }
}
