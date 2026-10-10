// What a bag item's, need's or product's ref is, for the page to show it the way a person reads it (run-viz FR4.4l): a blob shown in place, JSON as a tree with the JSON nested inside it decoded, a link where it leads, text otherwise.
import { needLink } from "./need-link";

export type ItemValue =
  | { kind: "blob"; hash: string }
  | { kind: "json"; value: unknown }
  | { kind: "link"; href: string; external: boolean }
  | { kind: "text"; text: string };

const BLOB_HASH = /^sha256-[0-9a-f]{64}$/;
const JSON_CONTAINER = /^\s*[[{]/;
// A line encodes a value as JSON more than once; past this many layers what is left stays a string.
const MAX_DEPTH = 5;

export function itemValueOf(ref: string, runId: string): ItemValue {
  if (BLOB_HASH.test(ref)) {
    return { kind: "blob", hash: ref };
  }
  const parsed = jsonContainerOf(ref);

  if (parsed !== undefined) {
    return { kind: "json", value: decodedNested(parsed, 1) };
  }
  const link = needLink(ref, runId);

  return link ? { kind: "link", ...link } : { kind: "text", text: ref };
}

/** An object or array the text holds as JSON; undefined for anything else, a bare number or string included. */
export function jsonContainerOf(text: string): unknown {
  if (!JSON_CONTAINER.test(text)) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function decodedNested(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return decodedString(value, depth);
  }

  if (Array.isArray(value)) {
    return value.map((member) => decodedNested(member, depth));
  }

  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, member]) => [
          key,
          decodedNested(member, depth),
        ]),
      )
    : value;
}

function decodedString(text: string, depth: number): unknown {
  const inner = depth > MAX_DEPTH ? undefined : jsonContainerOf(text);

  return inner === undefined ? text : decodedNested(inner, depth + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
