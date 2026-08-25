import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://imposter-partyspiel.gadia545.chatgpt.site"),
  title: "Imposter – Wer blufft?",
  description: "Das mobile Partyspiel für eine oder mehrere Geräte.",
  manifest: "/manifest.webmanifest",
  applicationName: "Imposter",
  appleWebApp: { capable: true, title: "Imposter", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icon-192.png" },
  openGraph: { title: "Imposter – Wer blufft?", description: "Das mobile Partyspiel für eine oder mehrere Geräte.", type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Imposter – Wer blufft?" }] },
  twitter: { card: "summary_large_image", title: "Imposter – Wer blufft?", description: "Das mobile Partyspiel für eine oder mehrere Geräte.", images: ["/og.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f4f0e7" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
