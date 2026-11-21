import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { GithubTokenPair } from "../../outbound/github-user-client.js";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

/** Seals a GitHub token pair with AES-256-GCM using a 32-byte key. */
export function encryptTokenPair(
  pair: GithubTokenPair,
  rawKey: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, parseKey(rawKey), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(pair), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/** Opens an encrypted GitHub token pair sealed by encryptTokenPair. */
export function decryptTokenPair(
  sealed: string,
  rawKey: string,
): GithubTokenPair {
  const { iv, tag, encrypted } = splitSealed(sealed);
  const decipher = createDecipheriv(ALGORITHM, parseKey(rawKey), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });

  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as GithubTokenPair;
}

function parseKey(rawKey: string): Buffer {
  const key = HEX_KEY.test(rawKey)
    ? Buffer.from(rawKey, "hex")
    : Buffer.from(rawKey, "base64");

  enforceTrue(
    key.length === KEY_BYTES,
    Error,
    "token encryption key must decode to 32 bytes",
  );

  return key;
}

function splitSealed(sealed: string) {
  const parts = sealed.split(":");

  enforceTrue(
    parts.length === 4 && parts[0] === VERSION,
    Error,
    "malformed encrypted token pair",
  );

  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const encrypted = Buffer.from(parts[3], "base64url");

  enforceTrue(
    iv.length === IV_BYTES && tag.length === AUTH_TAG_BYTES,
    Error,
    "malformed encrypted token pair",
  );

  return { iv, tag, encrypted };
}
