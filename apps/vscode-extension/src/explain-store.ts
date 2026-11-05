import { createHash } from "node:crypto";
import type { Explanation } from "./lore-client.js";

/** The subset of VS Code's `Memento` the cache needs; `context.globalState` survives a restart. */
export interface EntryStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface ExplainEntry {
  path: string;
  code: string;
  explanation: Explanation;
  savedAt: number;
}

/** A cached entry where its code sits in the current text, 1-based and inclusive. */
export interface PlacedEntry {
  entry: ExplainEntry;
  startLine: number;
  endLine: number;
}

/** Whether any spec statement grounds the entry's answer; an answer with none is "I don't know". */
export function isGrounded({ explanation }: ExplainEntry): boolean {
  return explanation.statements.length > 0;
}

const STORE_KEY = "lore.explanations";
const DEFAULT_LIMIT = 300;

/** Explanations keyed by file and exact code, so unchanged code is never asked about twice, across restarts too. */
export class ExplainCache {
  constructor(
    private readonly store: EntryStore,
    private readonly limit: number = DEFAULT_LIMIT,
    private readonly now: () => number = Date.now,
  ) {}

  find(path: string, code: string): ExplainEntry | undefined {
    return this.entries()[entryKey(path, code)];
  }

  entriesFor(path: string): ExplainEntry[] {
    return Object.values(this.entries())
      .filter((entry) => entry.path === path)
      .sort((a, b) => a.savedAt - b.savedAt);
  }

  async save(
    path: string,
    code: string,
    explanation: Explanation,
  ): Promise<void> {
    const entries = {
      ...this.entries(),
      [entryKey(path, code)]: { path, code, explanation, savedAt: this.now() },
    };

    await this.store.update(STORE_KEY, newestOnly(entries, this.limit));
  }

  private entries(): Record<string, ExplainEntry> {
    return this.store.get<Record<string, ExplainEntry>>(STORE_KEY) ?? {};
  }
}

function entryKey(path: string, code: string): string {
  return createHash("sha256").update(`${path}\n${code}`).digest("hex");
}

function newestOnly(
  entries: Record<string, ExplainEntry>,
  limit: number,
): Record<string, ExplainEntry> {
  const newestFirst = Object.entries(entries).sort(
    ([, a], [, b]) => b.savedAt - a.savedAt,
  );

  return Object.fromEntries(newestFirst.slice(0, limit));
}

/** Where each entry's code sits in `text` now: code that moved is followed, code that changed is dropped. */
export function placeEntries(
  entries: ExplainEntry[],
  text: string,
): PlacedEntry[] {
  return entries.flatMap((entry) => {
    const offset = lineStartOffset(text, entry.code);

    if (offset < 0) {
      return [];
    }
    const startLine = lineOf(text, offset);

    return [
      {
        entry,
        startLine,
        endLine: startLine + lineOf(entry.code, entry.code.length) - 1,
      },
    ];
  });
}

/** The first offset where `code` starts a line of `text`, or -1. */
function lineStartOffset(text: string, code: string): number {
  let offset = text.indexOf(code);

  while (offset > 0 && text[offset - 1] !== "\n") {
    offset = text.indexOf(code, offset + 1);
  }

  return offset;
}

/** The 1-based line of `offset` in `text`. */
function lineOf(text: string, offset: number): number {
  const before = text.slice(0, offset);

  return before.split("\n").length;
}
