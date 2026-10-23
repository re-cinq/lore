import { describe, it, expect } from "vitest";

describe("DeliveryContract", () => {
  it("includes a format command before git commit in getPodCommands", async () => {
    const { DeliveryContract } = await import("./delivery-contract.js");
    const contract = new DeliveryContract();
    const commands = contract.getPodCommands();

    expect(Array.isArray(commands)).toBe(true);

    const formatIdx = commands.findIndex(
      (cmd) => cmd.includes("prettier --write") || cmd.includes("FORMATTER"),
    );
    const commitIdx = commands.findIndex((cmd) => cmd.includes("git commit"));

    expect(formatIdx, "format command must be present").toBeGreaterThan(-1);
    expect(commitIdx, "git commit must be present").toBeGreaterThan(-1);
    expect(formatIdx, "format must precede commit").toBeLessThan(commitIdx);
  });
});
