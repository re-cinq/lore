// The wire shapes of one Utopia statements push: `POST /sources/{id}/statements` takes one item, its entities as [name, kindWord, true] and its statements as subject-phrase-object/value tuples.

import { posix } from "node:path";

/** `[name, kind word, true]`: the kind word is the ontology class label the knowledge base bound the word to. */
export type Entity = [string, string, true];

/** What qualifies one relation, such as the lines a test covers in a file. */
export type Qualifiers = Readonly<Record<string, string | number>>;

/** `[null, subject, phrase, object | null, value | null, qualifiers, null, null]`: a relation names an object and no value, an attribute a value and no object. */
export type Statement = [
  null,
  string,
  string,
  string | null,
  string | null,
  Qualifiers,
  null,
  null,
];

export interface StatementItem {
  externalId: string;
  /** The time the item's facts were true, ISO 8601; the document's commit time when known. */
  doc_time?: string;
  e: Entity[];
  s: Statement[];
}

export interface Tombstone {
  externalId: string;
  deleted: true;
}

export type PushItem = StatementItem | Tombstone;

/** Utopia refuses a push past 200 statements. */
export const MAX_STATEMENTS_PER_ITEM = 200;

/** Utopia refuses a body past 64 KiB; the builder stops short of it. */
export const MAX_ITEM_BYTES = 60 * 1024;

export function tombstone(externalId: string): Tombstone {
  return { externalId, deleted: true };
}

export function relation(
  subject: string,
  phrase: string,
  object: string,
  qualifiers: Qualifiers = {},
): Statement {
  return [null, subject, phrase, object, null, qualifiers, null, null];
}

export function attribute(
  subject: string,
  phrase: string,
  value: string,
): Statement {
  return [null, subject, phrase, null, value, {}, null, null];
}

/** A name Utopia records as a fact beside the canonical one, so a bare mention in prose resolves by exact name. */
export function knownAs(subject: string, name: string): Statement {
  return attribute(subject, "known_as", name);
}

/** The file's `path` and the two names a mention uses for it: its basename and its repo-relative path. */
export function sourceFileStatements(file: string, path: string): Statement[] {
  const names = [...new Set([posix.basename(path), path])];

  return [attribute(file, "path", path), ...names.map((n) => knownAs(file, n))];
}

export function isTombstone(pushed: PushItem): pushed is Tombstone {
  return "deleted" in pushed;
}

/** The body as Utopia reads it: snake_case external id, the notes list it requires, and nothing else of ours. */
export function wireBody(pushed: PushItem): Record<string, unknown> {
  if (isTombstone(pushed)) {
    return { external_id: pushed.externalId, deleted: true };
  }

  return {
    external_id: pushed.externalId,
    ...(pushed.doc_time ? { doc_time: pushed.doc_time } : {}),
    e: pushed.e,
    s: pushed.s,
    n: [],
  };
}

export function itemBytes(pushed: StatementItem): number {
  return Buffer.byteLength(JSON.stringify(wireBody(pushed)), "utf-8");
}

export function fitsOneItem(pushed: StatementItem): boolean {
  return (
    pushed.s.length <= MAX_STATEMENTS_PER_ITEM &&
    itemBytes(pushed) <= MAX_ITEM_BYTES
  );
}
