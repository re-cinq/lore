// The channels one socket holds: opened by a client-chosen id, capped, and closed together when the socket goes.

import { MAX_CHANNELS_PER_SOCKET, type LiveErrorCode } from "./protocol.js";

/** What the socket can do with an open channel: hand it client bytes, or close it from the client's side. */
export interface ChannelHandle {
  receive(bytes: Uint8Array): void;
  close(): void;
}

export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelHandle>();

  constructor(private readonly cap = MAX_CHANNELS_PER_SOCKET) {}

  /** Why an id cannot be opened right now, or null when it can. */
  refusal(id: string): LiveErrorCode | null {
    if (this.channels.has(id)) {
      return "channel_in_use";
    }

    return this.channels.size >= this.cap ? "too_many_channels" : null;
  }

  add(id: string, handle: ChannelHandle): void {
    this.channels.set(id, handle);
  }

  get(id: string): ChannelHandle | undefined {
    return this.channels.get(id);
  }

  /** Forgets the id without closing it — for a handler that ended the channel itself. */
  forget(id: string): void {
    this.channels.delete(id);
  }

  get size(): number {
    return this.channels.size;
  }

  closeAll(): void {
    for (const [id, handle] of [...this.channels]) {
      this.channels.delete(id);
      handle.close();
    }
  }
}
