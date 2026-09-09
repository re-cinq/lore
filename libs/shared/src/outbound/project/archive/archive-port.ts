/** project.archive — durable blob archival (agent-event streams, job-run logs). Consumers redact/shape the payload; the port only stores and retrieves it. */

export interface ArchiveSaveOptions {
  contentType: string;
  cacheControl?: string;
}

export interface ArchivePort {
  /** Text or bytes: an agent conversation archive is gzip, and storing binary through a utf-8 string round-trip corrupts it. */
  save(
    key: string,
    body: string | Uint8Array,
    options: ArchiveSaveOptions,
  ): Promise<void>;
  /** The object's utf-8 content, or null when it does not exist (or the read fails). */
  read(key: string): Promise<string | null>;
  /** The object's raw bytes, for content that is not text. Null when absent. */
  readBytes(key: string): Promise<Uint8Array | null>;
}
