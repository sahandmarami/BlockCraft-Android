import type { NextConfig } from "next";

// STATIC_EXPORT=1 → fully static site for offline WebView (APK) packaging:
// relative asset paths so file:///android_asset/www/index.html works offline.
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = isStatic
  ? {
      output: "export",
      assetPrefix: "./",
      trailingSlash: true,
      images: { unoptimized: true },
      typescript: { ignoreBuildErrors: true },
      reactStrictMode: false,
    }
  : {
      output: "standalone",
      typescript: { ignoreBuildErrors: true },
      reactStrictMode: false,
    };

export default nextConfig;
