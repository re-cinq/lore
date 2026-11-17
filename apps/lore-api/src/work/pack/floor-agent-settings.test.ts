import { describe, expect, it } from "vitest";
import {
  agentBodyOf,
  floorSettingsOf,
  packSettingsOf,
} from "./floor-agent-settings.js";

const PACK_SETTINGS = {
  model: "opus",
  image: "acme/agent:2",
  timeout_minutes: 10,
  config: { skills: ["lore-context"] },
  prices: {
    opus: {
      input_per_million: 5,
      output_per_million: 25,
      cache_read_per_million: 0.5,
    },
  },
  prompt: "Triage.",
};

const FLOOR_SETTINGS = {
  model: "opus",
  image: "acme/agent:2",
  timeoutMinutes: 10,
  config: { skills: ["lore-context"] },
  prices: {
    opus: {
      inputPerMillion: 5,
      outputPerMillion: 25,
      cacheReadPerMillion: 0.5,
    },
  },
  prompt: "Triage.",
};

describe("floorSettingsOf", () => {
  it("writes the pack settings the way the floor stores them", () => {
    expect(floorSettingsOf(PACK_SETTINGS)).toEqual(FLOOR_SETTINGS);
  });
});

describe("packSettingsOf", () => {
  it("reads the settings the floor holds as the snake_case the pack writes, without prices", () => {
    const { prices: _prices, ...expected } = PACK_SETTINGS;

    expect(packSettingsOf(FLOOR_SETTINGS)).toEqual(expected);
  });
});

describe("agentBodyOf", () => {
  it("writes the pack settings as the org default and keeps the repository variants the floor holds", () => {
    const held = {
      settings: { ...FLOOR_SETTINGS, prompt: "Old." },
      variants: { "github.com/acme/app": { model: "sonnet" } },
    };

    expect(agentBodyOf(held, PACK_SETTINGS)).toEqual({
      settings: FLOOR_SETTINGS,
      variants: { "github.com/acme/app": { model: "sonnet" } },
    });
  });

  it("writes a body with no variants for an agent the floor does not hold", () => {
    expect(agentBodyOf(undefined, PACK_SETTINGS)).toEqual({
      settings: FLOOR_SETTINGS,
    });
  });
});
