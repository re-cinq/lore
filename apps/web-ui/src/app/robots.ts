import type { MetadataRoute } from "next";

/** Lore is an internal tool: nothing on it should be crawled or indexed. Served before sign-in (see middleware.ts). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
