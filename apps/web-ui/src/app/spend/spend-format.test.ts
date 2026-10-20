import { describe, it, expect } from "vitest";
import { num, usd } from "./spend-format";

describe("spend-format", () => {
  it("formats money and counts in en-US whatever the machine's locale", () => {
    expect({ money: usd(82.5), count: num(1234567) }).toEqual({
      money: "$82.50",
      count: "1,234,567",
    });
  });
});
