import { describe, it, expect } from "vitest";
import { inboxKeyAction } from "./inbox-keys";

describe("inboxKeyAction", () => {
  it("moves down with j and up with k, staying inside the list", () => {
    expect(inboxKeyAction("j", 2, 3)).toEqual({ type: "move", index: 2 });
    expect(inboxKeyAction("k", 0, 3)).toEqual({ type: "move", index: 0 });
    expect(inboxKeyAction("j", 0, 3)).toEqual({ type: "move", index: 1 });
  });

  it("opens with e and ignores every key on an empty list", () => {
    expect(inboxKeyAction("e", 0, 1)).toEqual({ type: "open" });
    expect(inboxKeyAction("j", 0, 0)).toBeNull();
    expect(inboxKeyAction("x", 0, 3)).toBeNull();
  });
});
