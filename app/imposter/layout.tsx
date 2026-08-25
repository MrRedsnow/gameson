import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Imposter – Gameson",
  description: "Das Bluff- und Wortspiel für 3 bis 22 Personen – online oder auf einem Gerät.",
  openGraph: { title: "Imposter – Gameson", description: "Einer kennt nur die halbe Wahrheit.", images: [] },
  twitter: { title: "Imposter – Gameson", description: "Einer kennt nur die halbe Wahrheit.", images: [] },
};

export default function ImposterLayout({ children }: { children: React.ReactNode }) { return children; }
