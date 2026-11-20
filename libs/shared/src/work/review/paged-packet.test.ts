import { describe, expect, it } from "vitest";
import { pagedPacket } from "./paged-packet.js";

describe("pagedPacket", () => {
  it("writes a file's text as one numbered line per source line, so a reader can open any part of a large packet", () => {
    const packet = {
      mode: "code",
      files: [
        {
          path: "limit.ts",
          before: "const a = 1;\nexport { a };",
          after: null,
        },
      ],
    };

    expect(pagedPacket(packet).split("\n")).toEqual([
      "{",
      ' "mode": "code",',
      ' "files": [',
      "  {",
      '   "path": "limit.ts",',
      '   "before": [',
      '    "1| const a = 1;",',
      '    "2| export { a };"',
      "   ],",
      '   "after": null',
      "  }",
      " ]",
      "}",
    ]);
  });
});
