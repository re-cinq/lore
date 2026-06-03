import { describe, it, expect } from "vitest";
import {
  parseCostReport,
  parseUsageReport,
  mergeCostAndUsage,
} from "./anthropic-cost.js";

describe("parseCostReport", () => {
  it("converts the cents-string amount to dollars and flattens one bucket result", () => {
    const raw = {
      data: [
        {
          starting_at: "2025-08-01T00:00:00Z",
          ending_at: "2025-08-02T00:00:00Z",
          results: [
            {
              amount: "123.45",
              currency: "USD",
              cost_type: "tokens",
              model: "claude-opus-4-6",
              token_type: "uncached_input_tokens",
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };

    expect(parseCostReport(raw)).toEqual([
      { date: "2025-08-01", model: "claude-opus-4-6", costUsd: 1.2345 },
    ]);
  });
});

describe("parseUsageReport", () => {
  it("flattens token counts and sums the 1h and 5m ephemeral cache-creation buckets", () => {
    const raw = {
      data: [
        {
          starting_at: "2025-08-01T00:00:00Z",
          ending_at: "2025-08-02T00:00:00Z",
          results: [
            {
              model: "claude-opus-4-6",
              uncached_input_tokens: 1500,
              output_tokens: 500,
              cache_read_input_tokens: 200,
              cache_creation: {
                ephemeral_1h_input_tokens: 1000,
                ephemeral_5m_input_tokens: 500,
              },
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };

    expect(parseUsageReport(raw)).toEqual([
      {
        date: "2025-08-01",
        model: "claude-opus-4-6",
        inputTokens: 1500,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 1500,
      },
    ]);
  });
});

describe("mergeCostAndUsage", () => {
  it("sums cost per date+model and joins matching token counts", () => {
    const cost = [
      { date: "2025-08-01", model: "claude-opus-4-6", costUsd: 1.0 },
      { date: "2025-08-01", model: "claude-opus-4-6", costUsd: 0.5 },
    ];
    const usage = [
      {
        date: "2025-08-01",
        model: "claude-opus-4-6",
        inputTokens: 1500,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 1500,
      },
    ];

    expect(mergeCostAndUsage(cost, usage)).toEqual([
      {
        date: "2025-08-01",
        model: "claude-opus-4-6",
        costUsd: 1.5,
        inputTokens: 1500,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 1500,
      },
    ]);
  });
});
