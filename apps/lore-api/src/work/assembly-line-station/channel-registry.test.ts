import { describe, it, expect, vi } from "vitest";
import { ChannelRegistry, type ChannelHandle } from "./channel-registry.js";

const handle = (): ChannelHandle => ({ receive: vi.fn(), close: vi.fn() });

describe("ChannelRegistry", () => {
  it("refuses an id already open and any id past the cap", () => {
    const registry = new ChannelRegistry(2);

    registry.add("a", handle());

    expect(registry.refusal("a")).toBe("channel_in_use");
    expect(registry.refusal("b")).toBeNull();
    registry.add("b", handle());

    expect(registry.refusal("c")).toBe("too_many_channels");
  });

  it("closes every channel once and forgets them when the socket goes", () => {
    const registry = new ChannelRegistry();
    const one = handle();
    const two = handle();

    registry.add("1", one);
    registry.add("2", two);
    registry.closeAll();

    expect(one.close).toHaveBeenCalledTimes(1);
    expect(two.close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it("forgets a channel its handler ended without closing it again", () => {
    const registry = new ChannelRegistry();
    const ended = handle();

    registry.add("x", ended);
    registry.forget("x");
    registry.closeAll();

    expect(ended.close).not.toHaveBeenCalled();
    expect(registry.get("x")).toBeUndefined();
  });
});
