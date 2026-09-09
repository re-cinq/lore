"use client";
import React, { useMemo } from "react";
import { resolveHref } from "@/lib/github-links";

type AnchorProps = React.ComponentPropsWithoutRef<"a"> & { node?: unknown };

/** One markdown link resolved against the repo it was written in: a relative path becomes a blob URL on this branch, and anything leaving the site opens in a new tab with `noopener`. */
function ResolvedAnchor(props: AnchorProps & { repo: string; branch: string }) {
  const { href, children, node: _node, repo, branch, ...rest } = props;
  const { href: resolved, external } = resolveHref(href ?? "", repo, branch);
  const ext = external ? { target: "_blank", rel: "noopener noreferrer" } : {};

  return (
    <a href={resolved} {...ext} {...rest}>
      {children}
    </a>
  );
}

/** The `components` override that rewrites a document's markdown links against the repo they were written in. */
export function useResolvedMarkdownLinks(repo: string, branch: string) {
  return useMemo(
    () => ({
      a: (props: AnchorProps) => (
        <ResolvedAnchor {...props} repo={repo} branch={branch} />
      ),
    }),
    [repo, branch],
  );
}
