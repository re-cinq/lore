import { describe, it, expect } from "vitest";
import { openLocalCommandUri } from "./command-links.js";

describe("openLocalCommandUri", () => {
  it("encodes the target as a single-element argument array for the command", () => {
    expect(openLocalCommandUri({ path: "mcp-server/src/x.ts", line: 42 })).toBe(
      "command:lore.openLocal?" +
        encodeURIComponent('[{"path":"mcp-server/src/x.ts","line":42}]'),
    );
  });

  it("encodes spaces and brackets in the path so the URI stays well-formed", () => {
    const uri = openLocalCommandUri({ path: "a b/[x].ts", line: 1 });

    expect(uri).not.toContain(" ");
    expect(uri).not.toContain("[");
    expect(decodeURIComponent(uri.split("?")[1])).toBe(
      '[{"path":"a b/[x].ts","line":1}]',
    );
  });
});
