"use client";

import dynamic from "next/dynamic";

// BlockNote needs the DOM, so the editor never renders on the server.
const PlanWorkspace = dynamic(() => import("./PlanEditorPanel"), {
  ssr: false,
  loading: () => <p className="meta">Opening the plan…</p>,
});

export default PlanWorkspace;
