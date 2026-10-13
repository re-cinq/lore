import type { ServerMode } from "./repo-scope.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

export function toolHandlers(
  register: (server: never, mode: ServerMode) => void,
  mode: ServerMode,
): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(
      toolName: string,
      _desc: string,
      _schema: unknown,
      handler: ToolHandler,
    ) {
      handlers[toolName] = handler;
    },
  };

  register(fakeServer as never, mode);

  return handlers;
}
