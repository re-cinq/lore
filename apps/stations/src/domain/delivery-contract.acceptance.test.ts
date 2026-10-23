import { describe, it, expect } from "vitest";

describe("DeliveryContract", () => {
  it("enforces formatting before committing", async () => {
    const { DeliveryContract } = await import("./delivery-contract.js");
    const contract = new DeliveryContract();

    const commands = contract.getPodCommands();
    const formatIndex = commands.findIndex(
      (cmd: string) =>
        cmd.includes("prettier --write") || cmd.includes("FORMATTER"),
    );
    const commitIndex = commands.findIndex((cmd: string) =>
      cmd.includes("git commit"),
    );

    expect(formatIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(-1);
    expect(formatIndex).toBeLessThan(commitIndex);
  });

  it("correctly commits and pushes", async () => {
    const { DeliveryContract } = await import("./delivery-contract.js");
    const contract = new DeliveryContract();

    const commands = contract.getPodCommands();

    expect(commands.some((cmd: string) => cmd.includes("git commit"))).toBe(
      true,
    );
    expect(commands.some((cmd: string) => cmd.includes("git push"))).toBe(true);
  });
});
