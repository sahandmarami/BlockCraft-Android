import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "بلاک کرَفت | Block Craft",
  description: "بازی وکسلی ساختن با بلوک برای موبایل و دسکتاپ — دنیای بی‌پایان، شکستن و ساختن بلوک، چرخه شب و روز",
  applicationName: "Block Craft",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Block Craft",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#4f9c37",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
