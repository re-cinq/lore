"use client";

import dynamic from "next/dynamic";
import { PlanBodyLoading } from "./PlanDetailSkeleton";

const loadEditor = () => import("./PlanEditorPanel");

/** Starts downloading the editor's code (BlockNote) before the page knows it will show it, so the editor is not the last thing to arrive. */
export const preloadPlanEditor = (): void => void loadEditor();

// BlockNote needs the DOM, so the editor never renders on the server.
const PlanWorkspace = dynamic(loadEditor, {
  ssr: false,
  loading: () => <PlanBodyLoading label="Opening the plan…" />,
});

export default PlanWorkspace;
