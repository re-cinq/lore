// Where one viewer's frames go (specs/assembly-line-run-viz FR7): the feed writes frames and asks how far behind the viewer is; the socket channel is the production sink, the recording one the test double.

import type { RunStreamFrame } from "./run-stream-frame.js";

/** Why the feed ended a sink on its own: it could not keep up, or the feed itself failed. */
export type EndReason = "slow" | "error";

export interface FrameSink {
  send(frame: RunStreamFrame): void;
  /** Bytes written but not yet on the wire; past the high-water mark the viewer is dropped (FR5.4). */
  bufferedBytes(): number;
  end(reason: EndReason): void;
}

/** The in-memory sink: keeps every frame, reports the buffered size it was built with, remembers how it ended. */
export class RecordingSink implements FrameSink {
  readonly frames: RunStreamFrame[] = [];
  private endReason: EndReason | null = null;

  constructor(private readonly buffered = 0) {}

  send(frame: RunStreamFrame): void {
    this.frames.push(frame);
  }

  bufferedBytes(): number {
    return this.buffered;
  }

  end(reason: EndReason): void {
    this.endReason = reason;
  }

  get ended(): EndReason | null {
    return this.endReason;
  }

  get types(): string[] {
    return this.frames.map((frame) => frame.type);
  }

  get agentIds(): string[] {
    return this.frames.flatMap((frame) =>
      frame.type === "agent_event" ? [frame.event.id] : [],
    );
  }
}
