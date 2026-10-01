import type { Metadata } from "next";
import "./hive.css";

export const metadata: Metadata = {
  title: "HIVE – Gameson",
  description: "Umzingelt die gegnerische Königin. HIVE für zwei Personen: online oder gemeinsam auf einem Gerät, mit allen fünf Insekten des Grundspiels.",
  openGraph: { title: "HIVE – Gameson", description: "22 Steine. Zwei Köpfe. Eine Königin im Visier.", images: [] },
  twitter: { title: "HIVE – Gameson", description: "Strategie für zwei. Online oder auf einem Gerät.", images: [] },
};
export default function HiveLayout({ children }: { children: React.ReactNode }) { return <div className="hive-theme">{children}</div>; }
