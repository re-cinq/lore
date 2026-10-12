import { ImageResponse } from "next/og";
import { repoFavicon } from "./repo-favicon";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

interface RepoIconProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function Icon({ params }: RepoIconProps) {
  const { owner, repo } = await params;
  const { initials, backgroundColor } = repoFavicon(owner, repo);

  return new ImageResponse(
    <div style={badgeStyle(backgroundColor)}>{initials}</div>,
    size,
  );
}

function badgeStyle(backgroundColor: string) {
  return {
    alignItems: "center",
    background: backgroundColor,
    color: "white",
    display: "flex",
    fontSize: 30,
    fontWeight: 700,
    height: "100%",
    justifyContent: "center",
    width: "100%",
  } as const;
}
