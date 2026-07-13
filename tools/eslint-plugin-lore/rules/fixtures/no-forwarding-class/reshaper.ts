import type { UsagePort } from "./usage-port.js";

/** NOT a forwarding class: `counts` renames and `total` transforms. */
export class Reshaper {
  constructor(private readonly port: UsagePort) {}

  counts(): Promise<number> {
    return this.port.processedCounts();
  }

  async total(): Promise<number> {
    const processed = await this.port.processedCounts();

    return processed + 1;
  }
}
