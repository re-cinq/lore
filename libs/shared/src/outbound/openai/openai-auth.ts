// Authentication for Lore's OpenAI-compatible chat and embeddings adapters.

import { enforceTrue } from "../../lib/enforce.js";

export type OpenAiAuthHeader = "bearer" | "x-api-key";

export function openAiAuthHeader(env: NodeJS.ProcessEnv): OpenAiAuthHeader {
  const mode = (env.LORE_OPENAI_AUTH_HEADER || "bearer").toLowerCase();

  enforceTrue(
    mode === "bearer" || mode === "x-api-key",
    Error,
    "LORE_OPENAI_AUTH_HEADER must be bearer or x-api-key",
  );

  return mode;
}

export type OpenAiAuthInit = Pick<RequestInit, "headers" | "redirect">;

export function openAiAuthInit(
  apiKey: string,
  mode: OpenAiAuthHeader = "bearer",
): OpenAiAuthInit {
  if (mode === "x-api-key") {
    // Fetch can forward a custom header across origins when following redirects.
    return {
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      redirect: "manual",
    };
  }

  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
}
