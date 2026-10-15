import { describe, it, expect } from "vitest";
import { mirrorSource } from "./utopia-mirror.js";

const ENV = { UTOPIA_API_URL: "http://utopia.test" };
const SETTINGS = { utopia: { kb_id: "kb-1", source_id: "src-1" } };
const STORED = { id: "src-1", key: "utp_k", kbId: "kb-1" };

describe("mirrorSource", () => {
  it("pushes through the stored src-1 key when settings.utopia names src-1 and UTOPIA_API_URL is set", () => {
    expect(mirrorSource(SETTINGS, STORED, ENV)).toEqual({
      id: "src-1",
      key: "utp_k",
    });
  });

  it("is null without UTOPIA_API_URL, without a utopia block, without a stored key, and with a key stored for another source", () => {
    expect([
      mirrorSource(SETTINGS, STORED, {}),
      mirrorSource({ auto_review: true }, STORED, ENV),
      mirrorSource(SETTINGS, null, ENV),
      mirrorSource(SETTINGS, { ...STORED, id: "src-2" }, ENV),
    ]).toEqual([null, null, null, null]);
  });
});
