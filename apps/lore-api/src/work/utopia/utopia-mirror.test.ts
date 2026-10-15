import { describe, it, expect } from "vitest";
import { mirrorSource } from "./utopia-mirror.js";

const ENV = { UTOPIA_API_URL: "http://utopia.test" };

describe("mirrorSource", () => {
  it("reads the source id and key from settings.utopia when UTOPIA_API_URL is set", () => {
    expect(
      mirrorSource(
        { utopia: { kb_id: "kb-1", source_id: "src-1", source_key: "utp_k" } },
        ENV,
      ),
    ).toEqual({ id: "src-1", key: "utp_k" });
  });

  it("is null without UTOPIA_API_URL, without a utopia block, and with a block missing its key", () => {
    const block = { kb_id: "kb-1", source_id: "src-1", source_key: "utp_k" };

    expect([
      mirrorSource({ utopia: block }, {}),
      mirrorSource({ auto_review: true }, ENV),
      mirrorSource(null, ENV),
      mirrorSource({ utopia: { kb_id: "kb-1", source_id: "src-1" } }, ENV),
    ]).toEqual([null, null, null, null]);
  });
});
