// What a generateContent answer holds: its text, or the reason it holds none, and its token counts.

import { enforceTrue } from "../../lib/enforce.js";

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

export interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
}

/** The text of the first candidate; a response with none is an error naming why (a block, a stop reason), never an empty string a caller would hand on as a block. */
export function textFromResponse(response: GeminiResponse): string {
  const text = candidateParts(response)?.[0]?.text;

  enforceTrue(
    text !== undefined,
    Error,
    `Gemini returned no text (${noTextReason(response)})`,
  );

  return text;
}

function noTextReason(response: GeminiResponse): string {
  const candidate = response.candidates?.[0];

  return (
    response.promptFeedback?.blockReason ??
    candidate?.finishReason ??
    "no candidate"
  );
}

function candidateParts(
  response: GeminiResponse,
): Array<{ text?: string }> | undefined {
  const candidate = response.candidates?.[0];

  return candidate?.content?.parts;
}

export function tokensFromResponse(response: GeminiResponse): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
