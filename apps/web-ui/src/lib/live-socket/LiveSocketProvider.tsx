"use client";

// One live socket per tab, held above every page so a navigation from a plan to its run keeps the connection (ADR-048). Without an address there is no client, and every consumer falls back to polling.
import { createContext, useContext, useState, type ReactNode } from "react";
import { LiveSocketClient, type SocketConstructor } from "./client";

const LiveSocketContext = createContext<LiveSocketClient | null>(null);

export interface LiveSocketProviderProps {
  url: string | undefined;
  children: ReactNode;
  /** Injected by tests; the browser's own WebSocket otherwise. */
  socket?: SocketConstructor;
}

export function LiveSocketProvider({
  url,
  children,
  socket,
}: LiveSocketProviderProps) {
  const [client] = useState(() =>
    url === undefined ? null : new LiveSocketClient({ url, socket }),
  );

  return (
    <LiveSocketContext.Provider value={client}>
      {children}
    </LiveSocketContext.Provider>
  );
}

/** The tab's socket, or null when none is configured or no provider is mounted. */
export function useLiveSocket(): LiveSocketClient | null {
  return useContext(LiveSocketContext);
}
