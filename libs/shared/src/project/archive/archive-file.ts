// A filesystem ArchivePort, for a stack running on one machine.
//
// GCS is the deployed archive. Without a local equivalent, `agentEventsArchive()`
// is null on a laptop, so a conversation POST answers 202 "skipped" and the GET
// answers 404 — both by design, both silent, and together they make continuity
// impossible to exercise anywhere except a real cluster. Shipping a resume path
// that has only ever run in production is the failure this whole area keeps
// producing, so local dev gets somewhere to put the bytes.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { enforceTrue } from "../../lib/enforce.js";
import type { ArchivePort, ArchiveSaveOptions } from "./archive-port.js";

export class FileArchive implements ArchivePort {
  constructor(private readonly root: string) {}

  /** `options` carries the content type, which only an object store records —
   *  a file's type is its extension here, so it is accepted and ignored. */
  async save(
    key: string,
    body: string | Uint8Array,
    _options?: ArchiveSaveOptions,
  ): Promise<void> {
    const path = this.pathFor(key);

    enforceTrue(path, Error, `archive key escapes the root: "${key}"`);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof body === "string" ? body : Buffer.from(body));
  }

  async read(key: string): Promise<string | null> {
    const bytes = await this.readBytes(key);

    return bytes === null ? null : Buffer.from(bytes).toString("utf-8");
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const path = this.pathFor(key);

    if (!path) {
      return null;
    }

    // A missing object is not an error for either caller — the conversation GET
    // answers 404 and the pod degrades to a fresh conversation.
    return readFile(path).catch(() => null);
  }

  /** The absolute path for a key, or null when the key would escape the root. Keys
   *  are built from ids that arrive over HTTP, so traversal has to be refused here
   *  rather than trusted upstream. */
  private pathFor(key: string): string | null {
    const path = resolve(join(this.root, key));
    const rel = relative(resolve(this.root), path);

    return rel && !rel.startsWith("..") ? path : null;
  }
}
