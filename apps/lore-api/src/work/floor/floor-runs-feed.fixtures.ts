import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { vi } from "vitest";
import type { FloorFrame, FloorWatch, WatchEnd } from "@re-cinq/floor-client";
import type { RunListFrame } from "../assembly-line-station/protocol.js";
import type { FloorRunRow } from "./floor-run-rows.js";
import { FloorRunsFeed, type RunsViewer } from "./floor-runs-feed.js";

export function until(condition: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    enforceTrue(condition(), Error, "not yet");
  });
}

const BASE_ROW: FloorRunRow = {
  id: "run-1",
  blueprint_name: "code-review",
  definition_name: "code-review",
  task_id: null,
  repo: "re-cinq/lore",
  branch: null,
  subject_key: null,
  engine: "floor",
  status: "running",
  outcome: null,
  reason: null,
  created_at: "2026-10-02T10:00:00.000Z",
  started_at: "2026-10-02T10:00:01.000Z",
  finished_at: null,
  args_pr_number: null,
  spec_plan_summary: null,
  pr_url: null,
  task_pr_number: null,
  issue_url: null,
  issue_number: null,
  created_by: null,
  cost_usd: null,
  pipeline: [{ node_id: "review", state: "running" }],
};

export function row(over: Partial<FloorRunRow> = {}): FloorRunRow {
  return { ...BASE_ROW, ...over };
}

export function feedOverFreshFloors() {
  const floors: ControllableWatch[] = [];
  const feed = new FloorRunsFeed({
    watchFloor: () => {
      const floor = controllableWatch();

      floors.push(floor);

      return floor.watch;
    },
    rowOf: async () => null,
  });

  return { feed, floors };
}

export function feedOverRows() {
  const floor = controllableWatch();
  const asked: string[] = [];
  const feed = new FloorRunsFeed({
    watchFloor: () => floor.watch,
    rowOf: async (runId) => {
      asked.push(runId);

      return row({ id: runId });
    },
  });

  return { feed, floor, asked };
}

class ControllableWatch {
  private readonly queued: FloorFrame[] = [];
  private wake: (() => void) | null = null;
  private isStopped = false;
  private isEnded = false;
  private stops = 0;

  readonly watch: FloorWatch = {
    ended: Promise.resolve<WatchEnd>({ reason: "stopped" }),
    stop: () => {
      this.stops += 1;
      this.isStopped = true;
      this.wake?.();
    },
    [Symbol.asyncIterator]: () => this.frames(),
  };

  say(frame: FloorFrame): void {
    this.queued.push(frame);
    this.wake?.();
  }

  endNow(): void {
    this.isEnded = true;
    this.wake?.();
  }

  stopCount(): number {
    return this.stops;
  }

  private async *frames(): AsyncGenerator<FloorFrame> {
    while (!this.isStopped && !this.isEnded) {
      const frame = this.queued.shift();

      if (frame) {
        yield frame;
        continue;
      }
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

export function controllableWatch(): ControllableWatch {
  return new ControllableWatch();
}

export function recordingViewer(): RunsViewer & {
  frames: RunListFrame[];
  ended: string | null;
} {
  const viewer = {
    frames: [] as RunListFrame[],
    ended: null as string | null,
    send: (frame: RunListFrame) => {
      viewer.frames.push(frame);
    },
    end: (reason: string) => {
      viewer.ended = reason;
    },
  };

  return viewer;
}
