import { z } from "zod";
import type { ServerMode } from "./repo-scope.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

type Register = (server: never, mode: ServerMode) => void;

/** The handlers as registered, called directly: the arguments are not checked. */
export function toolHandlers(
  register: Register,
  mode: ServerMode,
): Record<string, ToolHandler> {
  return registeredTools(register, mode, (handler) => handler);
}

/** Like `toolHandlers`, but each call first passes the arguments through the schema the tool registered, as the MCP server does. A refused argument rejects, and the handler is not reached. */
export function checkedToolHandlers(
  register: Register,
  mode: ServerMode,
): Record<string, ToolHandler> {
  return registeredTools(
    register,
    mode,
    (handler, schema) => async (args) => handler(z.object(schema).parse(args)),
  );
}

/** Every tool `register` adds, each handler passed through `wrap` with the schema it was registered with. */
function registeredTools(
  register: Register,
  mode: ServerMode,
  wrap: (handler: ToolHandler, schema: z.ZodRawShape) => ToolHandler,
): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(
      toolName: string,
      _desc: string,
      schema: z.ZodRawShape,
      handler: ToolHandler,
    ) {
      handlers[toolName] = wrap(handler, schema);
    },
  };

  register(fakeServer as never, mode);

  return handlers;
}
