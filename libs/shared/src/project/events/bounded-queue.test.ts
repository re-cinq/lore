import { describe, it, expect } from "vitest";
import { BoundedQueue } from "./bounded-queue.js";

/** Whether a promise has settled, without waiting on it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");

  return (await Promise.race([promise, Promise.resolve(pending)])) !== pending;
}

describe("BoundedQueue", () => {
  it("resolves push immediately while a slot is free", async () => {
    const queue = new BoundedQueue<string>(2);

    expect(await settled(queue.push("a"))).toBe(true);
    expect({ size: queue.size, waiting: queue.waiting }).toEqual({
      size: 1,
      waiting: 0,
    });
  });

  it("leaves push pending once capacity is reached, so the producer blocks", async () => {
    const queue = new BoundedQueue<string>(1);

    await queue.push("a");
    const blocked = queue.push("b");

    expect(await settled(blocked)).toBe(false);
    expect({ size: queue.size, waiting: queue.waiting }).toEqual({
      size: 1,
      waiting: 1,
    });
  });

  it("admits the waiting producer when a shift frees the slot", async () => {
    const queue = new BoundedQueue<string>(1);

    await queue.push("a");
    const blocked = queue.push("b");

    expect(queue.shift()).toBe("a");
    await blocked;
    expect({ size: queue.size, waiting: queue.waiting }).toEqual({
      size: 1,
      waiting: 0,
    });
    expect(queue.shift()).toBe("b");
  });

  it("admits blocked producers in the order they arrived, so events keep their sequence", async () => {
    const queue = new BoundedQueue<string>(1);

    await queue.push("first");
    const second = queue.push("second");
    const third = queue.push("third");

    queue.shift();
    await second;
    queue.shift();
    await third;

    expect(queue.shift()).toBe("third");
  });

  it("returns undefined from shift on an empty queue", () => {
    expect(new BoundedQueue<string>(1).shift()).toBeUndefined();
  });

  it("rejects a capacity below 1, because a zero-slot queue blocks forever", () => {
    expect(() => new BoundedQueue<string>(0)).toThrow(
      new Error("BoundedQueue capacity must be at least 1, got 0"),
    );
  });
});
