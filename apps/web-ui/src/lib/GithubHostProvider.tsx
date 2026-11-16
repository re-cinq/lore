"use client";

// The GitHub host of this install, read on the server and handed to client components as data: a client bundle cannot read `process.env`.
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_GITHUB_HOST } from "./github-host";

const GithubHostContext = createContext<string>(DEFAULT_GITHUB_HOST);

export function GithubHostProvider({
  host,
  children,
}: {
  host: string;
  children: ReactNode;
}) {
  return (
    <GithubHostContext.Provider value={host}>
      {children}
    </GithubHostContext.Provider>
  );
}

export function useGithubHost(): string {
  return useContext(GithubHostContext);
}
