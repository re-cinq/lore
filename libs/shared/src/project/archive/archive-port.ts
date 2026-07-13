/**
 * project.archive — durable blob archival (agent-event streams, job-run logs).
 * Consumers redact/shape the payload; the port only stores and retrieves it.
 */

export interface ArchiveSaveOptions {
  contentType: string;
  cacheControl?: string;
}

export interface ArchivePort {
  save(key: string, body: string, options: ArchiveSaveOptions): Promise<void>;
  /** The object's utf-8 content, or null when it does not exist (or the read fails). */
  read(key: string): Promise<string | null>;
}
