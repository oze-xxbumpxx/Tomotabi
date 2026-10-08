import type { MetadataRoute } from "next";

// Next.jsの規約（app/manifest.ts）上の既定エクスポートの例外。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "tomotabi",
    display: "standalone",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
