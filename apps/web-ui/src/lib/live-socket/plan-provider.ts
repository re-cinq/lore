// The plan editor's Hocuspocus provider on the tab's shared socket (ADR-048): its websocket "polyfill" is one plan channel, so it reconnects by asking the client for a new channel.
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import type { LiveSocketClient } from "./client";
import { channelWebSocketFor } from "./channel-websocket";

export interface PlanProvider {
  provider: HocuspocusProvider;
  /** Destroys the provider's socket wrapper too, or its channel would linger after the editor is gone. */
  destroy(): void;
}

export function planProvider(
  client: LiveSocketClient,
  documentName: string,
  token: () => Promise<string>,
): PlanProvider {
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: "channel://plan",
    WebSocketPolyfill: channelWebSocketFor(client, documentName),
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: documentName,
    token,
  });

  // A provider handed a shared websocketProvider does not attach itself (the socket may be shared, so that is the caller's call); unattached it never sends its auth message and the editor sits at "connecting" forever.
  provider.attach();

  return { provider, destroy: () => websocketProvider.destroy() };
}
