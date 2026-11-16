"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isPlanPage } from "./repo-chrome";
import styles from "./RepoChrome.module.css";

interface RepoChromeProps {
  base: string;
  fullName: string;
  /** The repo header and tab bar, drawn on every page but a single plan's. */
  full: ReactNode;
}

/** A plan's page gives its height to the plan: one breadcrumb line stands in for the repo header and tabs. */
export default function RepoChrome({ base, fullName, full }: RepoChromeProps) {
  const pathname = usePathname();

  if (!isPlanPage(pathname, base)) {
    return full;
  }

  return (
    <nav className={styles.crumbs} aria-label="Breadcrumb">
      <Link href="/">Repositories</Link>
      <span aria-hidden="true">/</span>
      <Link href={base}>{fullName}</Link>
      <span aria-hidden="true">/</span>
      <Link href={`${base}/plans`}>Plans</Link>
    </nav>
  );
}
