import { describe, it, expect } from "vitest";
import { decryptTokenPair, encryptTokenPair } from "./token-cipher.js";

const KEY = "0123456789abcdef".repeat(4);

describe("token-cipher", () => {
  it("encrypts a token pair without exposing plaintext and decrypts it back with the same key", () => {
    const pair = {
      accessToken: "ghu_secret_access_tok",
      expiresIn: 28800,
      refreshToken: "ghr_secret_refresh_tok",
      refreshTokenExpiresIn: 15897600,
    };
    const encrypted = encryptTokenPair(pair, KEY);

    expect(encrypted).not.toContain(pair.accessToken);
    expect(encrypted).not.toContain(pair.refreshToken);
    expect(decryptTokenPair(encrypted, KEY)).toEqual(pair);
  });

  it("encrypts and decrypts a token pair with a 32-byte base64 key", () => {
    const pair = {
      accessToken: "ghu_secret_access_tok",
      expiresIn: 28800,
      refreshToken: "ghr_secret_refresh_tok",
      refreshTokenExpiresIn: 15897600,
    };
    const base64Key = Buffer.from(KEY, "hex").toString("base64");

    expect(
      decryptTokenPair(encryptTokenPair(pair, base64Key), base64Key),
    ).toEqual(pair);
  });

  it("refuses to decrypt a sealed token pair whose GCM auth tag or IV was truncated", () => {
    const encrypted = encryptTokenPair(
      {
        accessToken: "ghu_secret_access_tok",
        expiresIn: 28800,
        refreshToken: "ghr_secret_refresh_tok",
        refreshTokenExpiresIn: 15897600,
      },
      KEY,
    );

    expect(() => decryptTokenPair(withTruncatedTag(encrypted), KEY)).toThrow(
      /malformed|tag|authenticate/i,
    );
    expect(() => decryptTokenPair(withShortIv(encrypted), KEY)).toThrow(
      /malformed|iv|nonce|authenticate/i,
    );
  });

  it("refuses an empty or wrong key, a key of the wrong byte length, and tampered ciphertext", () => {
    const pair = {
      accessToken: "ghu_secret_access_tok",
      expiresIn: 28800,
      refreshToken: "ghr_secret_refresh_tok",
      refreshTokenExpiresIn: 15897600,
    };
    const encrypted = encryptTokenPair(pair, KEY);
    const wrongKey = "fedcba9876543210".repeat(4);

    expect(() => decryptTokenPair(encrypted, "")).toThrow(
      "token encryption key must decode to 32 bytes",
    );
    expect(() => decryptTokenPair(encrypted, wrongKey)).toThrow(
      /unable to authenticate data/i,
    );
    expect(() =>
      decryptTokenPair(withFlippedCiphertext(encrypted), KEY),
    ).toThrow(/unable to authenticate data/i);
  });

  it("refuses a sealed token pair with an unknown version or extra segment and a 16-byte key on encrypt", () => {
    const pair = {
      accessToken: "ghu_secret_access_tok",
      expiresIn: 28800,
      refreshToken: "ghr_secret_refresh_tok",
      refreshTokenExpiresIn: 15897600,
    };
    const encrypted = encryptTokenPair(pair, KEY);
    const shortKey = "0123456789abcdef".repeat(2);

    expect(() => encryptTokenPair(pair, shortKey)).toThrow(
      "token encryption key must decode to 32 bytes",
    );
    expect(() => decryptTokenPair(withVersion(encrypted, "v2"), KEY)).toThrow(
      "malformed encrypted token pair",
    );
    expect(() => decryptTokenPair(`${encrypted}:extra`, KEY)).toThrow(
      "malformed encrypted token pair",
    );
  });
});

function withVersion(sealed: string, version: string): string {
  const [, iv, tag, ciphertext] = sealed.split(":");

  return [version, iv, tag, ciphertext].join(":");
}

function withTruncatedTag(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(":");
  const shortTag = Buffer.from(tag, "base64url")
    .subarray(0, 4)
    .toString("base64url");

  return [version, iv, shortTag, ciphertext].join(":");
}

function withShortIv(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(":");
  const shortIv = Buffer.from(iv, "base64url")
    .subarray(0, 8)
    .toString("base64url");

  return [version, shortIv, tag, ciphertext].join(":");
}

function withFlippedCiphertext(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(":");
  const bytes = Buffer.from(ciphertext, "base64url");

  bytes[0] ^= 0xff;

  return [version, iv, tag, bytes.toString("base64url")].join(":");
}
