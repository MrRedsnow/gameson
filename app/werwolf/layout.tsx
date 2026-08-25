import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Werwolf – Gameson",
  description: "Vollautomatisches Werwolf für Gruppen ab drei Personen – online oder auf einem Gerät.",
  openGraph: { title: "Werwolf – Gameson", description: "Wenn das Dorf schläft, beginnt die Jagd.", images: [] },
  twitter: { title: "Werwolf – Gameson", description: "Wenn das Dorf schläft, beginnt die Jagd.", images: [] },
};

export default function WerewolfLayout({ children }: { children: React.ReactNode }) { return children; }
