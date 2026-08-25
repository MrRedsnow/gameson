import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://imposter-partyspiel.gadia545.chatgpt.site"),
  title: "Gameson – Spieleabend. Sofort.",
  description: "Imposter und Werwolf als mobile Gesellschaftsspiele – online oder gemeinsam auf einem Gerät.",
  manifest: "/manifest.webmanifest",
  applicationName: "Gameson",
  appleWebApp: { capable: true, title: "Gameson", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icon-192.png" },
  openGraph: { title: "Gameson – Spieleabend. Sofort.", description: "Imposter und Werwolf – zwei mobile Gesellschaftsspiele, sofort spielbereit.", type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Gameson – Imposter und Werwolf" }] },
  twitter: { card: "summary_large_image", title: "Gameson – Spieleabend. Sofort.", description: "Imposter und Werwolf – zwei mobile Gesellschaftsspiele, sofort spielbereit.", images: ["/og.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#11130f" };

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
