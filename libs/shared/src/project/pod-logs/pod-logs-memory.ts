/** Behavioral spec for PodLogsRepository; contract-tested with Pg adapter to pin (podName, seq) collapsing and seq ordering. */

import type { PodLogChunk } from "../../models/pod-log-chunk.js";
import type { PodLogChunkInsert, PodLogsRepository } from "./pod-logs-port.js";

export class InMemoryPodLogs implements PodLogsRepository {
  private readonly rows: PodLogChunk[] = [];
  private nextId = 1;

  constructor(private readonly now: () => Date = () => new Date()) {}

  appendBatch(chunks: PodLogChunkInsert[]): Promise<void> {
    for (const chunk of chunks) {
      const duplicate = this.rows.some(
        (row) => row.podName === chunk.podName && row.seq === chunk.seq,
      );

      if (!duplicate) {
        this.rows.push({
          ...chunk,
          id: String(this.nextId++),
          createdAt: this.now(),
        });
      }
    }

    return Promise.resolve();
  }

  listForJob(jobName: string): Promise<PodLogChunk[]> {
    const forJob = this.rows.filter((row) => row.jobName === jobName);
    // Sort by POD first, then seq within it; retries must show after original attempt, not interleaved.
    const podOrder = [...new Set(forJob.map((row) => row.podName))];

    return Promise.resolve(
      forJob.sort(
        (a, b) =>
          podOrder.indexOf(a.podName) - podOrder.indexOf(b.podName) ||
          a.seq - b.seq,
      ),
    );
  }

  pruneOld(olderThanDays: number): Promise<number> {
    const cutoff = this.now().getTime() - olderThanDays * 24 * 60 * 60 * 1000;
    const keep = this.rows.filter((row) => row.createdAt.getTime() >= cutoff);
    const removed = this.rows.length - keep.length;

    this.rows.length = 0;
    this.rows.push(...keep);

    return Promise.resolve(removed);
  }
}
