/**
 * The behavioural spec for {@link PodLogsRepository}, and the double every
 * consumer test runs against.
 *
 * Written first and kept honest by the shared contract test: the Pg adapter has
 * to agree with it, so `(podName, seq)` collapsing and `seq` ordering are
 * pinned here rather than living only in SQL nobody can run in a unit test.
 */

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
    return Promise.resolve(
      this.rows
        .filter((row) => row.jobName === jobName)
        .sort((a, b) => a.seq - b.seq),
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
