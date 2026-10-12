import type { Metadata } from "next";
import "./core-ball.css";

export const metadata: Metadata = {
  title: "Core Ball – Gameson",
  description: "Ein Tipp. Gutes Timing. Spielt Core Ball mit 2–8 Personen miteinander oder gegeneinander: online auf euren Handys oder gemeinsam auf einem Gerät.",
  openGraph: { title: "Core Ball – Gameson", description: "Findet euren Rhythmus. Setzt Kugeln, schafft Level und gebt weiter.", images: [] },
  twitter: { title: "Core Ball – Gameson", description: "Das Arcade-Spiel für eure Gruppe. Ein Gerät oder eigene Handys.", images: [] },
};
export default function CoreBallLayout({ children }: { children: React.ReactNode }) { return <div className="core-ball-theme">{children}</div>; }
