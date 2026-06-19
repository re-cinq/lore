/**
 * Fill `{key}` placeholders in a prompt template from an Agent's parameters.
 * Unknown placeholders are left untouched (so a typo surfaces in the prompt rather
 * than vanishing). Pure — the controller and the agent app share this contract.
 */
export function renderPrompt(
  template: string | undefined,
  parameters: Record<string, string> | undefined,
): string {
  if (!template) return "";
  const params = parameters ?? {};
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key] : match,
  );
}
