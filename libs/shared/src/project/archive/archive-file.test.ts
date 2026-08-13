import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileArchive } from "./archive-file.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "archive-file-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("FileArchive", () => {
  it("round-trips gzip bytes unchanged", async () => {
    // The reason this class exists: a conversation archive is gzip, and every byte
    // above 0x7F is lost to U+FFFD if it goes through a utf-8 round trip.
    const archive = new FileArchive(root);
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe, 0x80]);

    await archive.save("agent-conversations/round-2.tgz", bytes, {
      contentType: "application/gzip",
    });

    const read = await archive.readBytes("agent-conversations/round-2.tgz");

    expect(read && new Uint8Array(read)).toEqual(bytes);
  });

  it("round-trips text", async () => {
    const archive = new FileArchive(root);

    await archive.save("logs/run.ndjson", "line one\n", {
      contentType: "application/x-ndjson",
    });

    expect(await archive.read("logs/run.ndjson")).toBe("line one\n");
  });

  it("creates the directories a nested key implies", async () => {
    const archive = new FileArchive(root);

    await archive.save("a/b/c.txt", "x", { contentType: "text/plain" });

    expect(existsSync(join(root, "a", "b", "c.txt"))).toBe(true);
  });

  it("reads null for a key that was never written", async () => {
    const archive = new FileArchive(root);

    expect(await archive.read("missing")).toBeNull();
    expect(await archive.readBytes("missing")).toBeNull();
  });

  it("refuses a key that would escape the archive root", async () => {
    // Keys are composed from ids that reach the Floor over HTTP, so a traversing
    // key must not become a write anywhere on the disk.
    const archive = new FileArchive(root);

    await expect(
      archive.save("../escaped.txt", "x", { contentType: "text/plain" }),
    ).rejects.toThrow(
      new Error('archive key escapes the root: "../escaped.txt"'),
    );
  });

  it("reads null rather than throwing for a traversing key", async () => {
    const archive = new FileArchive(root);

    expect(await archive.read("../../etc/passwd")).toBeNull();
  });
});
