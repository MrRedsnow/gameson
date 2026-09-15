import type { Metadata } from "next";
import "./stadt-land-fluss.css";

export const metadata: Metadata = {
  title: "Stadt Land Fluss – Gameson",
  description: "Alle tippen gleichzeitig: Stadt Land Fluss mit eigenen Spalten, synchronem Timer und gemeinsamer Tap-Abstimmung. Für 2–22 Personen.",
  openGraph: { title: "Stadt Land Fluss – Gameson", description: "Ein Buchstabe. Eure Spalten. Alle spielen gleichzeitig.", images: [] },
  twitter: { title: "Stadt Land Fluss – Gameson", description: "Ein Buchstabe. Eure Spalten. Alle spielen gleichzeitig.", images: [] },
};
export default function StadtLandFlussLayout({ children }: { children: React.ReactNode }) { return <div className="slf-theme">{children}</div>; }
