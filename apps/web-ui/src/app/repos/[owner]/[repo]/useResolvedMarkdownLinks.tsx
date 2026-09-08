"use client";
import React, { useMemo } from "react";
import { resolveHref } from "@/lib/github-links";

/** Rewrites a document's markdown links against the repo they were written in: a relative path becomes a blob URL on this branch, and anything leaving the site opens in a new tab with `noopener`. */
export function useResolvedMarkdownLinks(repo: string, branch: string) {
  return useMemo(
    () => ({
      a(props: React.ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
        const { href, children, node: _node, ...rest } = props;
        const { href: resolved, external } = resolveHref(
          href ?? "",
          repo,
          branch,
        );
        const ext = external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {};

        return (
          <a href={resolved} {...ext} {...rest}>
            {children}
          </a>
        );
      },
    }),
    [repo, branch],
  );
}
