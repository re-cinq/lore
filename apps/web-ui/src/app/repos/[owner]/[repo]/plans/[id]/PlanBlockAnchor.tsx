"use client";

import { useEffect } from "react";
import styles from "./PlanBlockAnchor.module.scss";

// The editor fills in over the collab socket after the page opens, so the block a link names may not exist yet; past this the page stops looking.
const GIVE_UP_MS = 15_000;
const MARKED_MS = 2_500;

/** Brings the block a link names into view: a spec statement cites a plan block as `<plan page>#<block id>`. Renders nothing. */
export default function PlanBlockAnchor() {
  useEffect(() => {
    // Block ids are plain (uuids), so the hash is read as written: decoding would throw on a malformed escape and take the page down.
    const blockId = window.location.hash.slice(1);

    return blockId ? watchFor(blockId) : undefined;
  }, []);

  return null;
}

function watchFor(blockId: string): () => void {
  const selector = `[data-id="${CSS.escape(blockId)}"]`;
  const found = () => {
    const block = document.querySelector<HTMLElement>(selector);

    if (block) {
      stop();
      bringIntoView(block);
    }
  };
  const observer = new MutationObserver(found);
  const giveUp = setTimeout(() => stop(), GIVE_UP_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(giveUp);
  };

  observer.observe(document.body, { childList: true, subtree: true });
  found();

  return stop;
}

function bringIntoView(block: HTMLElement): void {
  block.scrollIntoView({ block: "center", behavior: "smooth" });
  block.classList.add(styles.anchored);
  setTimeout(() => block.classList.remove(styles.anchored), MARKED_MS);
}
